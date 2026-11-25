/* Build STATIC. This is the only proposed sudo entry point, never setuid.
 * No caller paths, environment, policy flags, command strings or interpreters.
 * Trusted base OS/root are outside the hostile-operator threat model. */
#define _GNU_SOURCE
#include <fcntl.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <unistd.h>

static int reject(void) {
    fputs("{\"result\":\"FAIL\",\"code\":\"STAGE10_HOST_REJECTED\"}\n", stderr);
    return 1;
}

static int protected_path(const char *path) {
    char buffer[PATH_MAX];
    struct stat info;
    size_t length = strlen(path);
    if (length >= sizeof(buffer) || path[0] != '/') return 0;
    memcpy(buffer, path, length + 1);
    /* Ancestors cannot be symlinks or writable by the invoking operator. */
    for (size_t i = 1; i <= length; ++i) {
        if (buffer[i] != '/' && i != length) continue;
        char saved = buffer[i];
        buffer[i] = '\0';
        if (lstat(buffer, &info) || info.st_uid != 0 || (info.st_mode & 0022)) return 0;
        if (i < length ? !S_ISDIR(info.st_mode) :
            (!S_ISREG(info.st_mode) || info.st_nlink != 1 || (info.st_mode & 07000))) return 0;
        buffer[i] = saved;
    }
    if (lstat("/", &info) || info.st_uid != 0 || !S_ISDIR(info.st_mode) || (info.st_mode & 0022)) return 0;
    return 1;
}

int main(int argc, char **argv) {
    const char *script = "/usr/local/libexec/travelos-stage10/operator.py";
    char python[PATH_MAX];
    if (getuid() != 0 || geteuid() != 0 || argc != 2 ||
        (strcmp(argv[1], "validate") && strcmp(argv[1], "activate"))) return reject();
    /* Static linkage is essential: loader injection must not precede clearenv. */
    if (clearenv() || setenv("PATH", "/usr/bin:/bin", 1) ||
        setenv("HOME", "/nonexistent", 1) || setenv("LANG", "C.UTF-8", 1)) return reject();
    umask(0077);
    struct rlimit core = {0, 0};
    if (setrlimit(RLIMIT_CORE, &core) || prctl(PR_SET_DUMPABLE, 0) || chdir("/")) return reject();
    if (!realpath("/usr/bin/python3", python) || !protected_path(python) ||
        !protected_path(script) || !protected_path("/usr/local/sbin/travelos-stage10-operator")) return reject();
    if (close_range(3, ~0U, 0)) return reject();
    char *const args[] = {python, "-I", (char *)script, argv[1], NULL};
    execv(python, args);
    return reject();
}

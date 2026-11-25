"""Stage10 operational child-process boundary; not a privileged command executor."""
import os
import math
import selectors
import signal
import subprocess
import time


def bounded_run(command, *, data=None, output_limit=1048576, timeout=60, **options):
    if (type(output_limit) is not int or output_limit < 1
            or type(timeout) not in (int, float) or not math.isfinite(timeout) or timeout <= 0
            or (data is not None and not isinstance(data, (bytes, bytearray, memoryview)))):
        raise ValueError('STAGE10_PROCESS_POLICY_REJECTED')
    deadline = time.monotonic() + timeout
    outputs = {'stdout': bytearray(), 'stderr': bytearray()}
    pending = memoryview(data or b'')
    selector = selectors.DefaultSelector()
    try:
        child = subprocess.Popen(command, stdin=subprocess.PIPE if data is not None else subprocess.DEVNULL,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True, **options)
    except BaseException:
        selector.close()
        raise
    try:
        for name in ('stdout', 'stderr'):
            stream = getattr(child, name)
            os.set_blocking(stream.fileno(), False)
            selector.register(stream, selectors.EVENT_READ, name)
        if child.stdin is not None:
            if pending:
                os.set_blocking(child.stdin.fileno(), False)
                selector.register(child.stdin, selectors.EVENT_WRITE, 'stdin')
            else:
                child.stdin.close()
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ValueError('STAGE10_PROCESS_TIMEOUT')
            for key, _ in selector.select(min(remaining, 0.1)):
                if key.data == 'stdin':
                    try:
                        sent = os.write(key.fd, pending[:65536])
                        pending = pending[sent:]
                    except BrokenPipeError:
                        pending = pending[len(pending):]
                    except BlockingIOError:
                        continue
                    if not pending:
                        selector.unregister(key.fileobj)
                        assert child.stdin is not None
                        child.stdin.close()
                    continue
                try:
                    block = os.read(key.fd, min(65536, output_limit + 1))
                except BlockingIOError:
                    continue
                if not block:
                    selector.unregister(key.fileobj)
                    getattr(child, key.data).close()
                else:
                    destination = outputs[key.data]
                    if len(destination) + len(block) > output_limit:
                        raise ValueError('STAGE10_PROCESS_OUTPUT_LIMIT')
                    destination.extend(block)
        while True:
            # Preserve the unreaped leader until its group has been cleaned;
            # a re-used PID must never become a kill target.
            status = os.waitid(os.P_PID, child.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
            if status is not None:
                code = status.si_status if status.si_code == os.CLD_EXITED else -status.si_status
                break
            if time.monotonic() >= deadline:
                raise ValueError('STAGE10_PROCESS_TIMEOUT')
            time.sleep(min(0.01, max(0, deadline - time.monotonic())))
        return subprocess.CompletedProcess(command, code, bytes(outputs['stdout']), bytes(outputs['stderr']))
    finally:
        # Only the process group established above; never a supplied PID/group.
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        child.wait()
        selector.close()
        for stream in (child.stdin, child.stdout, child.stderr):
            if stream is not None:
                stream.close()

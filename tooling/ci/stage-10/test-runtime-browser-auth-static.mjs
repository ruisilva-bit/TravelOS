import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as runtime from "./stage10-runtime-browser-auth.mjs";

test("static server confines symlink targets to the requested surface", async (t) => {
  assert.equal(typeof runtime.createBrowserAuthServer, "function");
  const root = await mkdtemp(path.join(os.tmpdir(), "stage10-static-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const admin = path.join(root, "admin-web");
  const portal = path.join(root, "portal-web");
  await mkdir(admin);
  await mkdir(portal);
  await writeFile(path.join(admin, "index.html"), "admin shell");
  await writeFile(path.join(portal, "secret.txt"), "portal secret");
  await symlink(path.join(portal, "secret.txt"), path.join(admin, "leak.txt"));
  await symlink(portal, path.join(admin, "leak-dir"));
  await symlink("index.html", path.join(admin, "inside.html"));
  const server = runtime.createBrowserAuthServer({
    artifact: root,
    manifest: { hosts: { admin: "admin.test", portal: "portal.test" } },
    adminPort: 1,
    portalPort: 1,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const request = (pathname) =>
    new Promise((resolve, reject) => {
      http
        .get(
          {
            host: "127.0.0.1",
            port: server.address().port,
            path: pathname,
            headers: { host: "admin.test" },
          },
          (response) => {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", (chunk) => {
              body += chunk;
            });
            response.on("end", () => resolve({ status: response.statusCode, body }));
          },
        )
        .on("error", reject);
    });
  assert.deepEqual(await request("/"), { status: 200, body: "admin shell" });
  assert.deepEqual(await request("/inside.html"), { status: 200, body: "admin shell" });
  assert.deepEqual(await request("/leak.txt"), { status: 404, body: "" });
  assert.deepEqual(await request("/leak-dir/secret.txt"), { status: 404, body: "" });
  await rm(admin, { recursive: true, force: true });
  await symlink(portal, admin);
  assert.deepEqual(await request("/secret.txt"), { status: 404, body: "" });
});

import assert from "node:assert/strict";
import { createServer, request as requestHttp } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { URL } from "node:url";
import test from "node:test";

import * as stage9BrowserAcceptance from "../../../tests/integration/helpers/stage9-browser-acceptance.ts";

const { startBuiltBrowserHost } = stage9BrowserAcceptance;

const listenLoopback = async (server) => {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  return address.port;
};

const requestHost = (host, requestPath) =>
  new Promise((resolve, reject) => {
    const request = requestHttp(
      {
        hostname: "127.0.0.1",
        port: Number(new URL(host.origin).port),
        path: requestPath,
        method: "GET",
        headers: { host: host.expectedHost },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            text: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.once("error", reject);
    request.end();
  });

test("production browser host selects extracted candidate assets instead of workspace dist", async (t) => {
  const resolveWebRoot = stage9BrowserAcceptance.resolveStage9BrowserWebRoot;
  assert.equal(typeof resolveWebRoot, "function");
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "travelos-stage9-browser-source-"));
  const artifactRoot = path.join(workspaceRoot, "candidate-artifact");
  const sourceDist = path.join(workspaceRoot, "apps/admin-web/dist");
  const candidateAdmin = path.join(artifactRoot, "admin-web");
  const candidatePortal = path.join(artifactRoot, "portal-web");
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  for (const [root, marker] of [
    [sourceDist, "WORKSPACE_DIST_SENTINEL"],
    [candidateAdmin, "EXTRACTED_ARTIFACT_SENTINEL"],
    [candidatePortal, "PORTAL_ARTIFACT_SENTINEL"],
  ]) {
    await mkdir(path.join(root, "assets"), { recursive: true });
    await writeFile(
      path.join(root, "index.html"),
      `<!doctype html><html lang="pt-PT"><body><main>${marker}</main></body></html>`,
    );
    await writeFile(path.join(root, "assets", "app.js"), `window.marker = "${marker}";`);
  }

  const adminRoot = resolveWebRoot({
    surface: "admin",
    repositoryRoot: workspaceRoot,
    artifactRoot,
  });
  const portalRoot = resolveWebRoot({
    surface: "portal",
    repositoryRoot: workspaceRoot,
    artifactRoot,
  });
  assert.equal(adminRoot, path.resolve(candidateAdmin));
  assert.equal(portalRoot, path.resolve(candidatePortal));

  const host = await startBuiltBrowserHost({ root: adminRoot, hostname: "admin.travelos.test" });
  t.after(() => host.close());
  const response = await requestHost(host, "/");
  assert.equal(response.status, 200);
  assert.match(response.text, /EXTRACTED_ARTIFACT_SENTINEL/u);
  assert.doesNotMatch(response.text, /WORKSPACE_DIST_SENTINEL/u);
});

test("browser harness serves the compiled SPA and proxies only API routes", async (t) => {
  const webRoot = await mkdtemp(path.join(tmpdir(), "travelos-stage9-browser-host-"));
  t.after(() => rm(webRoot, { recursive: true, force: true }));
  await mkdir(path.join(webRoot, "assets"));
  await writeFile(
    path.join(webRoot, "index.html"),
    '<!doctype html><html lang="pt-PT"><body><main id="admin-root">ADMIN_SHELL</main></body></html>',
  );
  await writeFile(path.join(webRoot, "assets", "app.js"), "window.adminLoaded = true;");
  await writeFile(path.join(webRoot, "assets", "app.css"), "body { color: black; }");

  let forwardedHost = null;
  const api = createServer((request, response) => {
    forwardedHost = request.headers.host ?? null;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ method: request.method, path: request.url }));
  });
  const apiPort = await listenLoopback(api);
  t.after(
    () =>
      new Promise((resolve, reject) => api.close((error) => (error ? reject(error) : resolve()))),
  );

  const host = await startBuiltBrowserHost({ root: webRoot, hostname: "admin.travelos.test" });
  t.after(() => host.close());
  host.setApiUpstreamPort(apiPort);

  const shell = await requestHost(host, "/");
  assert.equal(shell.status, 200);
  assert.match(shell.headers["content-type"] ?? "", /text\/html/iu);
  assert.match(shell.headers["cache-control"] ?? "", /private, no-store/iu);
  assert.match(shell.text, /ADMIN_SHELL/u);

  const script = await requestHost(host, "/assets/app.js");
  assert.equal(script.status, 200);
  assert.match(script.headers["content-type"] ?? "", /javascript/iu);
  assert.equal(script.text, "window.adminLoaded = true;");

  const stylesheet = await requestHost(host, "/assets/app.css");
  assert.equal(stylesheet.status, 200);
  assert.match(stylesheet.headers["content-type"] ?? "", /text\/css/iu);
  assert.equal(stylesheet.text, "body { color: black; }");

  const unknown = await requestHost(host, "/not-a-client-route");
  assert.equal(unknown.status, 404);
  assert.doesNotMatch(unknown.text, /ADMIN_SHELL/u);

  const apiResponse = await requestHost(host, "/api/test-probe");
  assert.equal(apiResponse.status, 200);
  assert.deepEqual(JSON.parse(apiResponse.text), { method: "GET", path: "/api/test-probe" });
  assert.equal(forwardedHost, host.expectedHost);
});

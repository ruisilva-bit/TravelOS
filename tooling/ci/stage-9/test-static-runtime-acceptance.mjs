import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { runStaticRuntimeAcceptance } from "./static-runtime-acceptance.mjs";

const startServer = async ({
  fallbackUnknownRoute = false,
  fallbackRoot = false,
  bodylessProtected = false,
} = {}) => {
  const server = createServer((request, response) => {
    const host = request.headers.host;
    const app =
      host === "admin.travelos.test" ? "admin" : host === "portal.travelos.test" ? "portal" : null;
    if (app === null) {
      response.writeHead(404).end();
      return;
    }
    if (request.url === "/" && fallbackRoot) {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, no-store",
      });
      response.end("<main>UNEXPECTED_API_SHELL</main>");
      return;
    }
    if (request.url === "/" || request.url.startsWith("/assets/")) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end('{"error":"not_found"}');
      return;
    }
    if (request.url === "/health/live") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ status: "ok", service: `${app}-api`, environment: "DEVELOPMENT" }),
      );
      return;
    }
    if (request.url.startsWith("/api/auth/")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"session":null,"user":null}');
      return;
    }
    if (request.url === "/api/staff/session-context" || request.url === "/api/portal/trips") {
      if (bodylessProtected) {
        response.writeHead(401).end();
        return;
      }
      response.writeHead(401, { "content-type": "application/json" });
      response.end('{"error":"unauthorized"}');
      return;
    }
    if (fallbackUnknownRoute) {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<main>UNEXPECTED_API_SHELL</main>");
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end('{"error":"not_found"}');
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  const listener = { host: "127.0.0.1", port: address.port };
  const manifest = {
    environment: "DEVELOPMENT",
    hosts: { admin: "admin.travelos.test", portal: "portal.travelos.test" },
    runtime: { listeners: { adminApi: listener, portalApi: listener } },
  };
  return {
    manifest,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
};

const verifiedArtifact = {
  result: "PASS",
  artifactId: "travelos-stage9-gen01-testfixture",
  shells: {
    admin: { assets: 2, entrypoint: "admin-web/index.html" },
    portal: { assets: 2, entrypoint: "portal-web/index.html" },
  },
  stage10Actions: 0,
};

test("runtime acceptance verifies artifact shells and read-only API realm boundaries", async () => {
  const fixture = await startServer();
  try {
    const result = await runStaticRuntimeAcceptance({
      manifest: fixture.manifest,
      artifact: verifiedArtifact,
    });
    assert.equal(result.result, "PASS");
    assert.equal(result.surfaces.admin.assets, 2);
    assert.equal(result.surfaces.portal.assets, 2);
    assert.equal(result.surfaces.admin.authenticationStatus, 200);
    assert.equal(result.surfaces.portal.authenticationStatus, 200);
    assert.equal(result.surfaces.admin.rootStatus, 404);
    assert.equal(result.surfaces.portal.rootStatus, 404);
    assert.equal(result.stage10Actions, 0);
  } finally {
    await fixture.close();
  }
});

test("runtime acceptance accepts bodyless 401 responses from anonymous protected routes", async () => {
  const fixture = await startServer({ bodylessProtected: true });
  try {
    const result = await runStaticRuntimeAcceptance({
      manifest: fixture.manifest,
      artifact: verifiedArtifact,
    });
    assert.equal(result.result, "PASS");
    assert.equal(result.surfaces.admin.protectedStatus, 401);
    assert.equal(result.surfaces.portal.protectedStatus, 401);
  } finally {
    await fixture.close();
  }
});

test("runtime acceptance rejects an unknown route served as the SPA shell", async () => {
  const fixture = await startServer({ fallbackUnknownRoute: true });
  try {
    await assert.rejects(
      runStaticRuntimeAcceptance({ manifest: fixture.manifest, artifact: verifiedArtifact }),
      /unknown route/u,
    );
  } finally {
    await fixture.close();
  }
});

test("runtime acceptance rejects an API root that serves a static shell", async () => {
  const fixture = await startServer({ fallbackRoot: true });
  try {
    await assert.rejects(
      runStaticRuntimeAcceptance({ manifest: fixture.manifest, artifact: verifiedArtifact }),
      /API must not serve the static shell/u,
    );
  } finally {
    await fixture.close();
  }
});

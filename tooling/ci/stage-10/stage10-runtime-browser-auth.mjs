// Local extracted-SPA authentication subset. No screenshots, traces or credential logs.
import assert from "node:assert/strict";
import http from "node:http";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { chromium, expect } from "@playwright/test";

export function createBrowserAuthServer({ artifact, manifest, adminPort, portalPort }) {
  const surfaces = {
    [manifest.hosts.admin]: { root: path.join(artifact, "admin-web"), port: adminPort },
    [manifest.hosts.portal]: { root: path.join(artifact, "portal-web"), port: portalPort },
  };
  const server = http.createServer(async (req, res) => {
    const host = (req.headers.host ?? "").split(":")[0];
    const surface = surfaces[host];
    if (!surface) {
      res.writeHead(421).end();
      return;
    }
    const pathname = new URL(req.url, "http://local").pathname;
    if (
      pathname === "/api" ||
      pathname.startsWith("/api/") ||
      pathname === "/health" ||
      pathname.startsWith("/health/")
    ) {
      const headers = { ...req.headers, host };
      if (headers.origin) headers.origin = `http://${host}`;
      const upstream = http.request(
        { host: "127.0.0.1", port: surface.port, path: req.url, method: req.method, headers },
        (response) => {
          res.writeHead(response.statusCode, response.headers);
          response.pipe(res);
        },
      );
      upstream.on("error", () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
      return;
    }
    const relative = pathname === "/" ? "index.html" : pathname.slice(1);
    const file = path.resolve(surface.root, relative);
    if (!file.startsWith(surface.root + path.sep)) {
      res.writeHead(404).end();
      return;
    }
    try {
      if (!(await lstat(surface.root)).isDirectory()) {
        res.writeHead(404).end();
        return;
      }
      const root = await realpath(surface.root);
      const target = await realpath(file);
      if (!target.startsWith(root + path.sep)) {
        res.writeHead(404).end();
        return;
      }
      const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      let content;
      try {
        content = await handle.readFile();
      } finally {
        await handle.close();
      }
      const type =
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
          ".woff2": "font/woff2",
        }[path.extname(file)] ?? "application/octet-stream";
      res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
      res.end(content);
    } catch {
      res.writeHead(404).end();
    }
  });
  return server;
}

export async function checkBrowserAuth({
  artifact,
  manifest,
  adminPort,
  portalPort,
  staff,
  portal,
  seed,
  totp,
}) {
  const server = createBrowserAuthServer({ artifact, manifest, adminPort, portalPort });
  let browser,
    step = "launch";
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const port = server.address().port;
    const adminOrigin = `http://${manifest.hosts.admin}:${port}`;
    const portalOrigin = `http://${manifest.hosts.portal}:${port}`;
    browser = await chromium.launch({
      headless: true,
      args: [
        `--host-resolver-rules=MAP ${manifest.hosts.admin} 127.0.0.1, MAP ${manifest.hosts.portal} 127.0.0.1`,
        "--no-proxy-server",
      ],
    });
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 320, height: 700 },
    ]) {
      const context = await browser.newContext({ viewport });
      try {
        await context.route("**/*", (route) => {
          const url = new URL(route.request().url());
          return [adminOrigin, portalOrigin].includes(url.origin)
            ? route.continue()
            : route.abort();
        });
        step = "staff login";
        const admin = await context.newPage();
        await admin.goto(adminOrigin);
        await admin.locator("#staff-email").fill(staff.email);
        await admin.locator("#staff-password").fill(staff.password);
        await admin.getByRole("button", { name: "Entrar", exact: true }).click();
        step = "staff mfa";
        await admin.locator("#staff-mfa-code").fill(await totp(seed));
        await admin.getByRole("button", { name: "Confirmar", exact: true }).click();
        step = "staff dashboard";
        await expect(admin.getByRole("heading", { name: "Visão geral" })).toBeVisible({
          timeout: 15000,
        });
        step = "portal login";
        const page = await context.newPage();
        await page.goto(portalOrigin);
        await page.locator("#portal-email").fill(portal.email);
        await page.locator("#portal-password").fill(portal.password);
        await page.getByRole("button", { name: "Entrar", exact: true }).click();
        step = "portal dashboard";
        await expect(page.getByRole("heading", { name: "As minhas viagens" })).toBeVisible({
          timeout: 15000,
        });
        step = "own sessions";
        for (const [p, realm] of [
          [admin, "staff"],
          [page, "portal"],
        ]) {
          const session = await p.evaluate(
            async (r) => (await fetch(`/api/auth/${r}/get-session`)).json(),
            realm,
          );
          assert.ok(session?.user?.id, "browser own-realm session missing");
        }
        step = "cookie domains";
        const cookies = await context.cookies();
        const staffCookie = cookies.find((c) => c.name === "travelos-dev-staff-session");
        const portalCookie = cookies.find((c) => c.name === "travelos-dev-portal-session");
        assert.ok(staffCookie && portalCookie, "realm cookies missing");
        assert.equal(staffCookie.domain, manifest.hosts.admin);
        assert.equal(portalCookie.domain, manifest.hosts.portal);
        assert.ok(!(await context.cookies(adminOrigin)).some((c) => c.name === portalCookie.name));
        assert.ok(!(await context.cookies(portalOrigin)).some((c) => c.name === staffCookie.name));
        // Deliberately inject the other realm's cookie at the target host in a fresh browser context.
        step = "cross sessions";
        for (const [origin, realm, cookie] of [
          [adminOrigin, "staff", portalCookie],
          [portalOrigin, "portal", staffCookie],
        ]) {
          const cross = await browser.newContext();
          try {
            await cross.route("**/*", (route) =>
              new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
            );
            await cross.addCookies([{ name: cookie.name, value: cookie.value, url: origin }]);
            const target = await cross.newPage();
            await target.goto(origin);
            const result = await target.evaluate(
              async (r) => (await fetch(`/api/auth/${r}/get-session`)).json(),
              realm,
            );
            assert.equal(result, null, "browser cross-realm session accepted");
          } finally {
            await cross.close();
          }
        }
      } finally {
        await context.close();
      }
    }
  } catch {
    throw new Error(`browser ${step}`);
  } finally {
    try {
      if (browser) await browser.close();
    } finally {
      if (server.listening)
        await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    }
  }
}

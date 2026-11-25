// A deliberately narrow, real-browser no-JavaScript shell check, not API acceptance.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import { chromium } from "@playwright/test";

export async function checkNoScriptForms(payload) {
  const shells = {};
  for (const surface of ["admin", "portal"]) {
    shells[surface] = await readFile(path.join(payload, `${surface}-web/index.html`));
  }
  let browser;
  let received = [];
  const server = createServer((request, response) => {
    if (request.method === "GET" && (request.url === "/admin" || request.url === "/portal")) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(shells[request.url.slice(1)]);
      return;
    }
    // Retain no body, credentials, URL query or arbitrary request headers.
    const route = request.url?.split("?")[0];
    if (route === "/api/auth/staff/sign-in/email" || route === "/api/auth/portal/sign-in/email") {
      received.push({ method: request.method, route, hasQuery: request.url.includes("?") });
      request.resume();
      response.writeHead(204);
      response.end();
      return;
    }
    response.writeHead(404);
    response.end();
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ javaScriptEnabled: false });
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.origin === origin ? route.continue() : route.abort();
    });
    for (const [surface, realm] of [
      ["admin", "staff"],
      ["portal", "portal"],
    ]) {
      const page = await context.newPage();
      await page.goto(`${origin}/${surface}`, { waitUntil: "load", timeout: 10000 });
      assert.equal(await page.locator("form").count(), 1);
      const form = page.locator("form");
      assert.equal(await form.getAttribute("method"), "post");
      assert.equal(await form.getAttribute("action"), `/api/auth/${realm}/sign-in/email`);
      await form.locator('[name="email"]').fill("fixture@example.invalid");
      await form.locator('[name="password"]').fill("synthetic-fixture-only");
      await Promise.all([
        page.waitForResponse(`${origin}/api/auth/${realm}/sign-in/email`, { timeout: 10000 }),
        form.locator('button[type="submit"], button:not([type])').click({ noWaitAfter: true }),
      ]);
      assert.deepEqual(received.at(-1), {
        method: "POST",
        route: `/api/auth/${realm}/sign-in/email`,
        hasQuery: false,
      });
      await page.close();
    }
    assert.equal(received.length, 2);
    return { forms: 2, submissions: 2 };
  } finally {
    try {
      if (browser) await browser.close();
    } finally {
      if (server.listening)
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      received = [];
    }
  }
}

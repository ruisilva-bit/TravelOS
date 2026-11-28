import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page, type Route } from "@playwright/test";

import {
  CUSTOMER_ID,
  LEAD_ID,
  MockQuoteApi,
  QUOTE_ID,
} from "../../../apps/admin-web/test/quote-fixtures.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const shotsDir = process.env["QUOTES_UI_SHOTS_DIR"];
const AGENCY = "019b0301-0000-7000-8000-000000000009";
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

const PREVIEW_HTML = `<!doctype html><meta charset="utf-8"><body style="margin:0;font-family:Georgia,serif">
<div style="padding:64px 24px;background:linear-gradient(135deg,#0e3b4a,#c0792b);color:#fff"><small>Pré-visualização do rascunho</small><h1 style="margin:8px 0">Madeira à vossa maneira</h1><p>Funchal, Madeira</p></div>
<div style="padding:24px"><h2>A vossa viagem</h2><p>Preparámos esta viagem de sete noites a Funchal, Madeira.</p></div></body>`;

let server: ReturnType<typeof spawn> | null = null;
let origin = "";

test.beforeAll(async () => {
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  server = spawn(
    process.execPath,
    [
      resolve(repositoryRoot, "node_modules/vite/bin/vite.js"),
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    { cwd: resolve(repositoryRoot, "apps/admin-web"), stdio: "ignore" },
  );
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(origin)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error("Vite dev server did not start");
});

test.afterAll(() => {
  server?.kill("SIGTERM");
});

const json = (route: Route, status: number, body: unknown): Promise<void> =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const install = async (page: Page, api: MockQuoteApi): Promise<void> => {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/staff/session-context") {
      return json(route, 200, {
        principalId: "p",
        agencyId: AGENCY,
        authorizationEpoch: "1",
        recentMfaVerifiedAtEpochMs: 1,
        canInviteStaff: true,
      });
    }
    if (url.pathname.endsWith("/preview")) {
      return route.fulfill({ status: 200, contentType: "text/html", body: PREVIEW_HTML });
    }
    if (url.pathname === `/api/admin/customers/${CUSTOMER_ID}` || url.pathname.includes(LEAD_ID)) {
      return json(route, 200, {});
    }
    const body =
      request.postData() === null ? undefined : (JSON.parse(request.postData() ?? "{}") as unknown);
    const answer = api.handle(request.method(), `${url.pathname}${url.search}`, body);
    return answer === null ? json(route, 404, {}) : json(route, answer[0], answer[1]);
  });
};

const shot = async (page: Page, name: string, fullPage = false): Promise<void> => {
  if (shotsDir === undefined) return;
  mkdirSync(shotsDir, { recursive: true });
  await page.screenshot({ path: resolve(shotsDir, `${name}.png`), fullPage });
};

for (const viewport of viewports) {
  test(`Proposal editor ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const api = new MockQuoteApi();
    api.quote["heroImageUrl"] = null;
    await install(page, api);
    await page.goto(`${origin}/#/orcamentos/${QUOTE_ID}`);
    await page.getByRole("tab", { name: "Proposta ao cliente" }).click();
    await expect(page.getByLabel("Frase de introdução")).toBeVisible();
    await page.getByRole("button", { name: "Gerar sugestão" }).click();
    await expect(page.getByLabel("Frase de introdução")).toHaveValue(/Funchal/u);
    await shot(page, `${viewport.name}-1-capa`);
    for (const [index, name] of [
      "Programa",
      "Incluído / Não incluído",
      "Imagens",
      "Condições",
    ].entries()) {
      await page.getByRole("button", { name, exact: true }).click();
      await shot(page, `${viewport.name}-${String(index + 2)}-${name.slice(0, 4).toLowerCase()}`);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    if (viewport.name === "desktop") {
      await page.getByRole("button", { name: "Telemóvel" }).click();
      await shot(page, "desktop-6-telemovel");
    }
  });
}

async function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => done(port));
    });
  });
}

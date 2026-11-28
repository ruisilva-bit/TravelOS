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
const adminWebRoot = resolve(repositoryRoot, "apps/admin-web");
const shotsDir = process.env["QUOTES_UI_SHOTS_DIR"];
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

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
    { cwd: adminWebRoot, stdio: "ignore" },
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
    const path = `${url.pathname}${url.search}`;
    if (url.pathname === "/api/staff/session-context") {
      return json(route, 200, {
        principalId: "p",
        agencyId: "019b0301-0000-7000-8000-000000000009",
        authorizationEpoch: "1",
        recentMfaVerifiedAtEpochMs: 1,
        canInviteStaff: true,
      });
    }
    if (url.pathname === `/api/admin/customers/${CUSTOMER_ID}`) {
      return json(route, 200, {
        id: CUSTOMER_ID,
        agencyId: "019b0301-0000-7000-8000-000000000009",
        displayName: "Marta Quintela",
        email: "marta.quintela@example.test",
        phone: "+351 912 345 678",
        notes: null,
        lockVersion: "1",
        createdAt: "2026-11-01T10:00:00.000Z",
        updatedAt: "2026-11-01T10:00:00.000Z",
        people: [],
        leads: [{ id: LEAD_ID, name: "Madeira em maio", state: "QUALIFIED" }],
        trips: [],
      });
    }
    if (url.pathname === `/api/admin/leads/${LEAD_ID}`) {
      return json(route, 200, {
        id: LEAD_ID,
        agencyId: "019b0301-0000-7000-8000-000000000009",
        source: "WEBSITE",
        contactGivenName: "Marta",
        contactFamilyName: "Quintela",
        contactEmail: null,
        contactPhone: "+351 912 345 678",
        internalNote: "Quer visitar a Madeira em maio",
        state: "QUALIFIED",
        qualifiedCustomerId: CUSTOMER_ID,
        disqualificationReason: null,
        lockVersion: "2",
        createdAt: "2026-11-01T10:00:00.000Z",
        updatedAt: "2026-11-02T10:00:00.000Z",
        closedAt: null,
      });
    }
    if (url.pathname === "/api/admin/leads") {
      return json(route, 200, { items: [], nextCursor: null });
    }
    const body =
      request.postData() === null ? undefined : (JSON.parse(request.postData() ?? "{}") as unknown);
    const answer = api.handle(request.method(), path, body);
    return answer === null ? json(route, 404, {}) : json(route, answer[0], answer[1]);
  });
};

const shot = async (page: Page, name: string, fullPage = true): Promise<void> => {
  if (shotsDir === undefined) return;
  mkdirSync(shotsDir, { recursive: true });
  await page.screenshot({ path: resolve(shotsDir, `${name}.png`), fullPage });
};

const noHorizontalOverflow = async (page: Page): Promise<void> => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  if (overflow > 1 && process.env["QUOTES_UI_DEBUG"]) {
    console.log(
      await page.evaluate(() =>
        [...document.querySelectorAll("body *")]
          .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1)
          .slice(0, 8)
          .map((e) => `${e.tagName}.${e.className} ${Math.round(e.getBoundingClientRect().right)}`)
          .join("\n"),
      ),
    );
  }
  expect.soft(overflow).toBeLessThanOrEqual(1);
};

for (const viewport of viewports) {
  test.describe(`Quotes UI ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("list, editor, drawer and send flow", async ({ page, context }) => {
      await context
        .grantPermissions(["clipboard-read", "clipboard-write"], { origin })
        .catch(() => undefined);
      const api = new MockQuoteApi();
      await install(page, api);

      await page.goto(`${origin}/#/orcamentos`);
      await expect(page.getByRole("link", { name: "ORC-2027-0007" })).toBeVisible();
      await noHorizontalOverflow(page);
      await shot(page, `${viewport.name}-01-lista`);

      await page.goto(`${origin}/#/orcamentos/${QUOTE_ID}`);
      await expect(page.getByRole("heading", { name: "Orçamento ORC-2027-0007" })).toBeVisible();
      await expect(page.getByLabel("Serviço: Hotel Atlântico, Funchal")).toBeVisible();
      await noHorizontalOverflow(page);
      await shot(page, `${viewport.name}-02-editor`);
      await shot(page, `${viewport.name}-02a-topo`, false);
      await page.getByLabel("Serviço: Hotel Atlântico, Funchal").scrollIntoViewIfNeeded();
      await shot(page, `${viewport.name}-02b-linhas`, false);

      // Inline edit saves the whole line once, on blur.
      const supplier = page.getByLabel("Fornecedor: Passeio de levada", { exact: true });
      await supplier.fill("Levadas Exemplo");
      await supplier.blur();
      await expect.poll(() => api.writes().filter((c) => c.method === "PATCH").length).toBe(1);
      expect(api.lines.find((l) => l.service === "Passeio de levada")?.["supplier"]).toBe(
        "Levadas Exemplo",
      );

      if (viewport.name === "mobile") {
        await page
          .getByRole("button", { name: /PVP final/u })
          .first()
          .click();
        await shot(page, `${viewport.name}-03-resumo`);
      }

      await page.getByRole("button", { name: "Ações da linha Hotel Atlântico, Funchal" }).click();
      if (process.env["QUOTES_UI_DEBUG"]) {
        await page.waitForTimeout(300);
        console.log(
          "MENU",
          await page.locator("[role=menu]").count(),
          await page.evaluate(
            () => `${window.scrollY} ${document.activeElement?.outerHTML.slice(0, 80)}`,
          ),
        );
      }
      await page.getByRole("menuitem", { name: "Detalhes…" }).click();
      await expect(page.getByRole("dialog", { name: /Detalhes/u })).toBeVisible();
      await shot(page, `${viewport.name}-04-detalhes`, false);
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "Enviar ao cliente" }).click();
      await shot(page, `${viewport.name}-05-enviar`, false);
      await page.getByRole("button", { name: "Criar link e mensagem" }).click();
      await expect(page.getByRole("button", { name: "Copiar mensagem" })).toBeVisible();
      await shot(page, `${viewport.name}-06-mensagem`, false);
      await page.getByRole("button", { name: "Copiar link" }).click();
      await expect(page.getByText("Link copiado.")).toBeVisible();
      await page.getByRole("button", { name: "Concluir" }).click();
      await expect(page.getByText(/Orçamento enviado ao cliente/u)).toBeVisible();
      await expect(page.getByRole("button", { name: "Editar (nova versão)" })).toBeVisible();
      await shot(page, `${viewport.name}-07-enviado`);
    });

    test("accepted quote, lead and customer sections", async ({ page }) => {
      const api = new MockQuoteApi({
        state: "ACCEPTED",
        versions: [
          {
            id: "019b0301-0000-7000-8000-000000000501",
            quoteId: QUOTE_ID,
            versionNumber: 1,
            sentAt: "2026-11-28T09:00:00.000Z",
            pvpFinalMinor: "100000",
            currencyCode: "EUR",
            payloadSha256: "ab".repeat(32),
            acceptance: { acceptedAt: "2026-11-29T10:00:00.000Z", acceptedName: "Marta Quintela" },
            isLatest: true,
            shareLinks: [
              {
                shareLinkId: "019b0301-0000-7000-8000-000000000601",
                versionId: "019b0301-0000-7000-8000-000000000501",
                versionNumber: 1,
                createdAt: "2026-11-28T09:00:00.000Z",
                expiresAt: "2099-12-12T23:59:59.000Z",
                revokedAt: null,
              },
            ],
          },
        ],
      });
      await install(page, api);
      await page.goto(`${origin}/#/orcamentos/${QUOTE_ID}`);
      await expect(page.getByText("Aceite por Marta Quintela em", { exact: false })).toBeVisible();
      await expect(page.getByRole("button", { name: "Converter em viagem" })).toBeVisible();
      await shot(page, `${viewport.name}-08-aceite`);

      await page.goto(`${origin}/#/leads/${LEAD_ID}`);
      await expect(page.getByRole("button", { name: "Novo orçamento" })).toBeEnabled();
      await shot(page, `${viewport.name}-09-lead`);

      await page.goto(`${origin}/#/clientes/${CUSTOMER_ID}`);
      await page.getByRole("tab", { name: "Orçamentos" }).click();
      await expect(page.getByRole("link", { name: "ORC-2027-0007" })).toBeVisible();
      await shot(page, `${viewport.name}-10-cliente`);
    });
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

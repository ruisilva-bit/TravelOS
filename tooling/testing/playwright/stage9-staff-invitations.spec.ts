import { spawn } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const adminWebRoot = resolve(repositoryRoot, "apps/admin-web");
const adminSessionContext = {
  principalId: "staff-principal-browser-test",
  agencyId: "019a0101-0000-7000-8000-000000000002",
  authorizationEpoch: "1",
  recentMfaVerifiedAtEpochMs: 1_793_039_999_999,
  canInviteStaff: true,
};
const invitationId = "019a0101-0000-7000-8000-000000000003";
const fakeTokenOne = "A".repeat(43);
const fakeTokenTwo = "B".repeat(43);
const fakeEmail = "qa-browser@example.test";
const fakePassword = "synthetic-browser-password";
const fakeRecoveryCodes = ["SYNTHETIC-RECOVERY-ONE", "SYNTHETIC-RECOVERY-TWO"];
const syntheticTotpUri =
  "otpauth://totp/TravelOS%20Staff:qa-browser%40example.test?secret=NOT-A-REAL-SEED&issuer=TravelOS%20Staff";
const viewports = [
  { name: "desktop 1280x800", width: 1280, height: 800 },
  { name: "mobile 390x844", width: 390, height: 844 },
] as const;
type ExpectedRouteResponse = {
  readonly method: string;
  readonly path: string;
  readonly status: number;
};
type BrowserResponseObservation = {
  readonly method: string;
  readonly path: string;
  readonly status: number;
};
type RuntimeDiagnostics = {
  readonly errors: () => string[];
  readonly responses: () => readonly BrowserResponseObservation[];
};

let previewProcess: ReturnType<typeof spawn> | null = null;
let previewOrigin = "";
let previewPort = 0;
let previewOutput = "";

test.beforeAll(async () => {
  previewPort = await reserveLoopbackPort();
  previewOrigin = `http://127.0.0.1:${previewPort}`;
  previewProcess = spawn(
    process.execPath,
    [
      resolve(repositoryRoot, "node_modules/vite/bin/vite.js"),
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(previewPort),
      "--strictPort",
    ],
    { cwd: adminWebRoot, stdio: ["ignore", "pipe", "pipe"] },
  );
  previewProcess.stdout?.on("data", (chunk: Buffer) => {
    previewOutput += chunk.toString();
  });
  previewProcess.stderr?.on("data", (chunk: Buffer) => {
    previewOutput += chunk.toString();
  });
  await waitForPreview();
});

test.afterAll(async () => {
  const child = previewProcess;
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
    child.kill("SIGTERM");
    await Promise.race([exited, delay(5_000)]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
  }
  if (previewPort > 0 && (await isLoopbackPortAvailable(previewPort)) === false) {
    throw new Error("The owned Admin preview listener remained open after Playwright cleanup.");
  }
});

for (const viewport of viewports) {
  test.describe(`Staff invitation acceptance — ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("uses a generic route and a JSON POST without retaining credentials", async ({ page }) => {
      const diagnostics = watchRuntimeErrors(page, [
        { method: "POST", path: "/api/staff/invitations/accept", status: 204 },
      ]);
      const acceptRequests: Array<{
        method: string;
        url: string;
        bodyKeys: string[];
        tokenLength: number;
        nameMatches: boolean;
        passwordPresent: boolean;
      }> = [];
      const observedRequests: string[] = [];
      page.on("request", (request) => observedRequests.push(request.url()));
      await page.route("**/api/staff/invitations/accept", async (route) => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        acceptRequests.push({
          method: route.request().method(),
          url: route.request().url(),
          bodyKeys: Object.keys(body).sort(),
          tokenLength: typeof body.token === "string" ? body.token.length : 0,
          nameMatches: body.name === "QA Staff Browser",
          passwordPresent: typeof body.password === "string" && body.password.length > 0,
        });
        await route.fulfill({ status: 204 });
      });

      const response = await page.goto(`${previewOrigin}/#/staff/invitations/accept`);
      expect(response?.status()).toBe(200);
      await expect(page).toHaveTitle(/TravelOS/u);
      await expect(page.getByRole("heading", { name: "Aceitar convite de Staff" })).toBeVisible();
      const form = page.getByRole("form", { name: "Aceitar convite de Staff" });
      expect(await form.getAttribute("method")).toBe("post");
      expect(await form.getAttribute("action")).toBe("/api/staff/invitations/accept");
      await expectNoHorizontalOverflow(page);
      await expectAccessible(page);

      await page.getByLabel("Código do convite").fill(fakeTokenOne);
      await page.getByLabel("Nome completo").fill("QA Staff Browser");
      await page.getByLabel("Criar palavra-passe").fill(fakePassword);
      await page.getByLabel("Código do convite").focus();
      await page.keyboard.press("Tab");
      expect(
        await page.getByLabel("Nome completo").evaluate((node) => node === document.activeElement),
      ).toBe(true);
      await page.keyboard.press("Tab");
      expect(
        await page
          .getByLabel("Criar palavra-passe")
          .evaluate((node) => node === document.activeElement),
      ).toBe(true);
      await page.keyboard.press("Tab");
      expect(
        await page
          .getByRole("button", { name: "Aceitar convite" })
          .evaluate((node) => node === document.activeElement),
      ).toBe(true);
      await page.keyboard.press("Enter");

      await expect(page.getByRole("heading", { name: "Convite aceite" })).toBeVisible();
      expect(acceptRequests).toHaveLength(1);
      const captured = acceptRequests[0];
      expect(captured?.method).toBe("POST");
      expect(new URL(captured?.url ?? previewOrigin).search).toBe("");
      expect({
        keys: captured?.bodyKeys,
        tokenLength: captured?.tokenLength,
        nameMatches: captured?.nameMatches,
        passwordPresent: captured?.passwordPresent,
      }).toEqual({
        keys: ["name", "password", "token"],
        tokenLength: 43,
        nameMatches: true,
        passwordPresent: true,
      });
      const credentialsRetained = await page.evaluate(
        ({ token, password }) => {
          const persisted = `${localStorage.getItem("token") ?? ""}${sessionStorage.getItem("token") ?? ""}`;
          const visible = document.body.textContent ?? "";
          return (
            window.location.href.includes(token) ||
            window.location.href.includes(password) ||
            persisted.includes(token) ||
            persisted.includes(password) ||
            visible.includes(token) ||
            visible.includes(password)
          );
        },
        { token: fakeTokenOne, password: fakePassword },
      );
      expect(credentialsRetained).toBe(false);
      expect(
        observedRequests.every((url) => !url.includes(fakeTokenOne) && !url.includes(fakePassword)),
      ).toBe(true);
      await expectNoHorizontalOverflow(page);
      await expectAccessible(page);
      expect(
        diagnostics
          .responses()
          .filter((response) => response.path === "/api/staff/invitations/accept")
          .map((response) => response.status),
      ).toEqual([204]);
      expect(diagnostics.errors()).toEqual([]);
    });
  });

  test.describe(`Staff invitation management — ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("issues, reissues and revokes using safe API metadata and an ephemeral token handoff", async ({
      page,
    }) => {
      const diagnostics = watchRuntimeErrors(page);
      const apiRequests: Array<{ method: string; url: string; body: string | null }> = [];
      let issued = false;
      let revoked = false;
      const createdAt = new Date(Date.now() - 1_000).toISOString();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1_000).toISOString();
      const metadata = (status: "PENDING" | "REVOKED" = "PENDING") => ({
        invitationId,
        targetEmail: fakeEmail,
        status,
        createdAt,
        expiresAt,
        consumedAt: null,
        revokedAt: status === "REVOKED" ? new Date().toISOString() : null,
      });

      await page.route("**/api/staff/session-context", async (route) =>
        fulfillJson(route, 200, adminSessionContext),
      );
      await page.route("**/api/admin/staff/invitations**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const path = url.pathname;
        apiRequests.push({
          method: request.method(),
          url: request.url(),
          body: request.postData(),
        });

        if (request.method() === "GET" && path === "/api/admin/staff/invitations") {
          return fulfillJson(route, 200, {
            items: issued ? [metadata(revoked ? "REVOKED" : "PENDING")] : [],
            nextCursor: null,
          });
        }
        if (request.method() === "POST" && path === "/api/admin/staff/invitations") {
          issued = true;
          return fulfillJson(route, 201, { invitation: metadata(), token: fakeTokenOne });
        }
        if (
          request.method() === "POST" &&
          path === `/api/admin/staff/invitations/${invitationId}/reissue`
        ) {
          return fulfillJson(route, 200, { invitation: metadata(), token: fakeTokenTwo });
        }
        if (
          request.method() === "POST" &&
          path === `/api/admin/staff/invitations/${invitationId}/revoke`
        ) {
          revoked = true;
          return fulfillJson(route, 200, metadata("REVOKED"));
        }
        return route.fulfill({ status: 404, body: "" });
      });
      await page.addInitScript(() => {
        const testWindow = window as Window & { __stage9ConfirmCount?: number };
        testWindow.__stage9ConfirmCount = 0;
        window.confirm = () => {
          testWindow.__stage9ConfirmCount = (testWindow.__stage9ConfirmCount ?? 0) + 1;
          return true;
        };
      });

      const response = await page.goto(`${previewOrigin}/#/staff/invitations`);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { name: "Convites de equipa" })).toBeVisible();
      await expect(page.getByText("Ainda não existem convites de equipa.")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectAccessible(page);
      expect(await page.getByRole("combobox").count()).toBe(0);

      const issueForm = page.getByRole("form", { name: "Emitir convite para Staff" });
      expect(await issueForm.getAttribute("method")).toBe("post");
      await page.getByLabel("Email profissional").fill(fakeEmail);
      await page.getByRole("button", { name: "Emitir convite" }).click();
      const tokenField = page.getByLabel("Token de utilização única");
      await expect(tokenField).toBeVisible();
      expect((await tokenField.inputValue()) === fakeTokenOne).toBe(true);
      expect(
        await page.getByRole("link", { name: "Abrir aceitação do convite" }).getAttribute("href"),
      ).toBe("#/staff/invitations/accept");
      expect(await page.getByText(/Trip Operations/u).count()).toBeGreaterThan(0);
      const firstHandoffRetained = await page.evaluate(
        ({ token }) => {
          const persisted = `${localStorage.getItem("token") ?? ""}${sessionStorage.getItem("token") ?? ""}`;
          return window.location.href.includes(token) || persisted.includes(token);
        },
        { token: fakeTokenOne },
      );
      expect(firstHandoffRetained).toBe(false);
      await expectNoHorizontalOverflow(page);
      await expectAccessible(page);

      await page.getByRole("button", { name: "Fechar e apagar o token" }).click();
      await expect(tokenField).toHaveCount(0);
      await expect(page.getByText(fakeEmail)).toBeVisible();
      await page.reload();
      await expect(page.getByText(fakeEmail)).toBeVisible();
      await expect(page.getByLabel("Token de utilização única")).toHaveCount(0);
      const tokenReturnedAfterReload = await page
        .locator("body")
        .evaluate(
          (body) =>
            (body.textContent ?? "").includes("A".repeat(43)) ||
            (body.textContent ?? "").includes("B".repeat(43)),
        );
      expect(tokenReturnedAfterReload).toBe(false);

      await page.getByRole("button", { name: "Reemitir token" }).click();
      await expect(page.getByLabel("Token de utilização única")).toBeVisible();
      expect(
        await page.evaluate(
          () => (window as Window & { __stage9ConfirmCount?: number }).__stage9ConfirmCount,
        ),
      ).toBe(1);
      expect(
        (await page.getByLabel("Token de utilização única").inputValue()) === fakeTokenTwo,
      ).toBe(true);
      expect(
        apiRequests.every(
          (request) => !request.url.includes(fakeTokenOne) && !request.url.includes(fakeTokenTwo),
        ),
      ).toBe(true);
      expect(
        apiRequests
          .filter((request) => request.method === "POST")
          .every((request) => request.body !== null && request.body.length < 1_000),
      ).toBe(true);

      await page.getByRole("button", { name: "Fechar e apagar o token" }).click();
      await page.getByRole("button", { name: "Revogar convite" }).click();
      await expect(page.getByText("Revogado")).toBeVisible();
      expect(
        await page.evaluate(
          () => (window as Window & { __stage9ConfirmCount?: number }).__stage9ConfirmCount,
        ),
      ).toBe(2);
      await expect(page.getByRole("button", { name: "Revogar convite" })).toHaveCount(0);
      expect(
        apiRequests.some((request) => request.method === "POST" && request.url.endsWith("/revoke")),
      ).toBe(true);
      expect(diagnostics.errors()).toEqual([]);
    });
  });

  test.describe(`First-time Staff MFA — ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("keeps Admin data unavailable until recovery codes are acknowledged and TOTP succeeds", async ({
      page,
    }) => {
      const diagnostics = watchRuntimeErrors(page, [
        { method: "GET", path: "/api/staff/session-context", status: 401 },
        { method: "POST", path: "/api/auth/staff/two-factor/verify-totp", status: 400 },
      ]);
      let contextRequests = 0;
      let enabled = false;
      let validTotpVerified = false;
      let adminTripRequests = 0;
      const authRequestPaths: string[] = [];

      await page.route("**/api/staff/session-context", async (route) => {
        contextRequests += 1;
        if (contextRequests === 1) return route.fulfill({ status: 401, body: "" });
        return fulfillJson(route, 200, {
          ...adminSessionContext,
          canInviteStaff: false,
          recentMfaVerifiedAtEpochMs: Date.now(),
        });
      });
      await page.route("**/api/admin/trips?**", async (route) => {
        adminTripRequests += 1;
        return fulfillJson(route, 200, { items: [], nextCursor: null });
      });
      await page.route("**/api/auth/staff/**", async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        authRequestPaths.push(`${request.method()} ${path}`);
        if (path.endsWith("/sign-in/email")) {
          return fulfillJson(route, 200, {
            token: "synthetic-session-token",
            user: { id: "staff-user-browser-test", email: fakeEmail, name: "QA Staff Browser" },
          });
        }
        if (path.endsWith("/get-session")) {
          return fulfillJson(route, 200, {
            session: {
              id: "synthetic-session-id",
              token: "synthetic-session-token",
              userId: "staff-user-browser-test",
              expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            user: {
              id: "staff-user-browser-test",
              email: fakeEmail,
              name: "QA Staff Browser",
              emailVerified: true,
              twoFactorEnabled: enabled,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          });
        }
        if (path.endsWith("/two-factor/enable")) {
          enabled = true;
          return fulfillJson(route, 200, {
            totpURI: syntheticTotpUri,
            backupCodes: fakeRecoveryCodes,
          });
        }
        if (path.endsWith("/two-factor/verify-totp")) {
          const body = request.postDataJSON() as { code?: unknown };
          if (body.code !== "123456") {
            return fulfillJson(route, 400, { code: "INVALID_CODE", message: "Invalid code" });
          }
          validTotpVerified = true;
          return fulfillJson(route, 200, { token: "synthetic-session-token" });
        }
        return fulfillJson(route, 404, { code: "NOT_FOUND", message: "Not found" });
      });

      const response = await page.goto(`${previewOrigin}/`);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { name: "Entrar na equipa" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectAccessible(page);
      const loginForm = page.getByRole("form", { name: "Entrar na equipa" });
      expect(await loginForm.getAttribute("method")).toBe("post");

      await page.getByLabel("Email profissional").fill(fakeEmail);
      await page.getByLabel("Palavra-passe").fill(fakePassword);
      await page.getByRole("button", { name: "Entrar" }).click();
      await expect(
        page.getByRole("heading", { name: "Configurar autenticação de dois fatores" }),
      ).toBeVisible();
      expect(adminTripRequests).toBe(0);
      expect(contextRequests).toBe(1);
      await expectNoHorizontalOverflow(page);
      await expectAccessible(page);

      await page.getByLabel("Palavra-passe atual").fill(fakePassword);
      await page.getByRole("button", { name: "Ativar autenticação" }).click();
      await expect(
        page.getByRole("heading", { name: "Guarde os códigos de recuperação" }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Continuar" })).toBeDisabled();
      expect(
        await page
          .getByRole("list", { name: "Códigos de recuperação" })
          .getByRole("listitem")
          .count(),
      ).toBe(fakeRecoveryCodes.length);
      const secretsVisibleInRecoveryStep = await page.evaluate(
        ({ uri, codes }) => {
          const text = document.body.textContent ?? "";
          return text.includes(uri) && codes.every((code) => text.includes(code));
        },
        { uri: syntheticTotpUri, codes: fakeRecoveryCodes },
      );
      expect(secretsVisibleInRecoveryStep).toBe(true);
      expect(adminTripRequests).toBe(0);
      expect(contextRequests).toBe(1);
      await expectNoHorizontalOverflow(page);
      await expectAccessible(page);

      await page
        .getByRole("checkbox", { name: "Guardei os códigos de recuperação num local seguro" })
        .check();
      await page.getByRole("button", { name: "Continuar" }).click();
      await expect(page.getByLabel("Código da aplicação de autenticação")).toBeVisible();
      const recoverySecretsCleared = await page.evaluate(
        ({ uri, codes }) => {
          const text = document.body.textContent ?? "";
          return !text.includes(uri) && codes.every((code) => !text.includes(code));
        },
        { uri: syntheticTotpUri, codes: fakeRecoveryCodes },
      );
      expect(recoverySecretsCleared).toBe(true);
      expect(adminTripRequests).toBe(0);
      expect(contextRequests).toBe(1);

      await page.getByLabel("Código da aplicação de autenticação").fill("000000");
      await page.getByRole("button", { name: "Validar e continuar" }).click();
      await expect(page.getByRole("alert")).toHaveText(
        "Não foi possível validar o código. Tente novamente.",
      );
      expect(adminTripRequests).toBe(0);
      expect(contextRequests).toBe(1);
      expect(validTotpVerified).toBe(false);

      await page.getByLabel("Código da aplicação de autenticação").fill("123456");
      await page.getByRole("button", { name: "Validar e continuar" }).click();
      await expect(page.getByRole("heading", { name: "Visão geral" })).toBeVisible();
      expect(validTotpVerified).toBe(true);
      expect(contextRequests).toBe(2);
      await expect.poll(() => adminTripRequests).toBe(1);
      const secretsPersisted = await page.evaluate(
        ({ token, password, uri, codes }) => {
          const persisted = `${localStorage.getItem("token") ?? ""}${sessionStorage.getItem("token") ?? ""}`;
          const visible = document.body.textContent ?? "";
          return [token, password, uri, ...codes].some(
            (secret) =>
              persisted.includes(secret) ||
              visible.includes(secret) ||
              window.location.href.includes(secret),
          );
        },
        {
          token: fakeTokenOne,
          password: fakePassword,
          uri: syntheticTotpUri,
          codes: fakeRecoveryCodes,
        },
      );
      expect(secretsPersisted).toBe(false);
      expect(
        authRequestPaths.every((path) => !path.includes(fakePassword) && !path.includes("123456")),
      ).toBe(true);
      await expectNoHorizontalOverflow(page);
      await expectAccessible(page);
      expect(
        diagnostics
          .responses()
          .filter((response) => response.path === "/api/staff/session-context")
          .map((response) => response.status),
      ).toEqual([401, 200]);
      expect(
        diagnostics
          .responses()
          .filter((response) => response.path === "/api/auth/staff/two-factor/verify-totp")
          .map((response) => response.status),
      ).toEqual([400, 200]);
      expect(diagnostics.errors()).toEqual([]);
    });
  });
}

test("the static no-JavaScript Staff sign-in submits credentials by POST only", async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 1280, height: 800 },
  });
  try {
    const page = await context.newPage();
    const captured: {
      method: string;
      hasQuery: boolean;
      emailPosted: boolean;
      passwordPosted: boolean;
      credentialsInUrl: boolean;
    }[] = [];
    await page.route("**/api/auth/staff/sign-in/email", async (route) => {
      const request = route.request();
      const url = request.url();
      const body = request.postData() ?? "";
      captured.push({
        method: request.method(),
        hasQuery: new URL(url).search.length > 0,
        emailPosted: body.includes("qa-browser%40example.test") || body.includes(fakeEmail),
        passwordPosted: body.includes(fakePassword),
        credentialsInUrl: url.includes(fakeEmail) || url.includes(fakePassword),
      });
      await route.fulfill({ status: 401, contentType: "text/plain", body: "Denied" });
    });
    const response = await page.goto(`${previewOrigin}/`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Entrar na equipa" })).toBeVisible();
    const form = page.getByRole("form", { name: "Entrar na equipa" });
    expect(await form.getAttribute("method")).toBe("post");
    expect(await form.getAttribute("action")).toBe("/api/auth/staff/sign-in/email");
    await page.getByLabel("Email profissional").fill(fakeEmail);
    await page.getByLabel("Palavra-passe").fill(fakePassword);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      page.getByRole("button", { name: "Entrar" }).click(),
    ]);
    expect(captured).toHaveLength(1);
    const request = captured[0];
    expect(request).toEqual({
      method: "POST",
      hasQuery: false,
      emailPosted: true,
      passwordPosted: true,
      credentialsInUrl: false,
    });
    expect(page.url().includes(fakeEmail) || page.url().includes(fakePassword)).toBe(false);
  } finally {
    await context.close();
  }
});

async function reserveLoopbackPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolveListen, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolveListen);
  });
  const address = probe.address();
  if (!address || typeof address === "string")
    throw new Error("Could not reserve an ephemeral port.");
  const port = (address as AddressInfo).port;
  await new Promise<void>((resolveClose, reject) => {
    probe.close((error) => (error ? reject(error) : resolveClose()));
  });
  return port;
}

async function waitForPreview(): Promise<void> {
  const child = previewProcess;
  if (!child) throw new Error("The Admin preview process was not started.");
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`The Admin preview process exited before readiness: ${previewOutput}`);
    }
    try {
      const response = await fetch(`${previewOrigin}/`);
      const html = await response.text();
      if (response.ok && html.includes("TravelOS — Operações de viagem")) return;
    } catch {
      await delay(100);
      continue;
    }
    await delay(100);
  }
  throw new Error(`The built Admin preview did not become ready: ${previewOutput}`);
}

async function isLoopbackPortAvailable(port: number): Promise<boolean> {
  const probe = createServer();
  return new Promise<boolean>((resolveListen, reject) => {
    probe.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") return resolveListen(false);
      reject(error);
    });
    probe.listen(port, "127.0.0.1", () => {
      probe.close((error) => (error ? reject(error) : resolveListen(true)));
    });
  });
}

async function fulfillJson(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function watchRuntimeErrors(
  page: Page,
  expectedResponses: readonly ExpectedRouteResponse[] = [],
): RuntimeDiagnostics {
  const errors: string[] = [];
  const observedResponses: BrowserResponseObservation[] = [];
  const responses = new Map<string, number>();
  const expectedRequestFailures = new Set(
    expectedResponses.map(({ method, path, status }) => `${method} ${path}:${status}`),
  );
  const expectedConsoleErrors = new Set(
    expectedResponses.map(({ path, status }) => `${path}:${status}`),
  );
  page.on("pageerror", (error) => errors.push(`pageerror:${error.name}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      const locationUrl = message.location().url;
      const sourcePath = locationUrl ? new URL(locationUrl).pathname : "no-source";
      const status = message.text().match(/status of (\d{3})/u)?.[1] ?? "unknown";
      if (!expectedConsoleErrors.has(`${sourcePath}:${status}`)) {
        errors.push(`console:error:${status}:${sourcePath}`);
      }
    }
  });
  page.on("requestfailed", (request) => {
    const path = new URL(request.url()).pathname;
    const key = `${request.method()} ${path}`;
    const status = responses.get(key);
    const reason = request.failure()?.errorText ?? "unknown";
    const expectedEmptyResponseAbort =
      reason === "net::ERR_ABORTED" &&
      !request.isNavigationRequest() &&
      status !== undefined &&
      expectedRequestFailures.has(`${key}:${status}`);
    if (!expectedEmptyResponseAbort) {
      errors.push(
        `requestfailed:${key}:status=${status ?? "none"}:navigation=${request.isNavigationRequest()}:resource=${request.resourceType()}:reason=${reason}`,
      );
    }
  });
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    const method = response.request().method();
    responses.set(`${method} ${path}`, response.status());
    observedResponses.push({ method, path, status: response.status() });
    if (response.status() >= 500) errors.push(`http:${response.status()}`);
  });
  return { errors: () => errors, responses: () => observedResponses };
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(dimensions.documentWidth <= dimensions.viewportWidth + 1).toBe(true);
}

async function expectAccessible(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const violations = result.violations.map(({ id, impact, nodes }) => ({
    id,
    impact,
    affectedNodes: nodes.length,
  }));
  expect(violations).toEqual([]);
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

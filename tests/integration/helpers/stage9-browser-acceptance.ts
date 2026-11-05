import assert from "node:assert/strict";
import { chmod, lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createServer, request as requestHttp } from "node:http";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { AxeBuilder } from "@axe-core/playwright";
import { chromium, expect as browserExpect, type Page } from "@playwright/test";

export interface BuiltBrowserHost {
  readonly origin: string;
  readonly expectedHost: string;
  readonly webRoot: string;
  setApiUpstreamPort(port: number): void;
  close(): Promise<void>;
}

export interface Stage9BrowserWebRootInput {
  readonly surface: "admin" | "portal";
  readonly repositoryRoot: string;
  readonly artifactRoot?: string;
}

export const resolveStage9BrowserWebRoot = ({
  surface,
  repositoryRoot,
  artifactRoot,
}: Stage9BrowserWebRootInput): string => {
  if (artifactRoot !== undefined) {
    assert.ok(isAbsolute(artifactRoot), "Stage 9 candidate artifact root must be absolute");
    return resolve(artifactRoot, `${surface}-web`);
  }
  return resolve(repositoryRoot, `apps/${surface}-web/dist`);
};

const staticContentTypes: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export const startBuiltBrowserHost = async ({
  root,
  hostname,
}: {
  readonly root: string;
  readonly hostname: string;
}): Promise<BuiltBrowserHost> => {
  const webRoot = await realpath(resolve(root));
  const [index, assets] = await Promise.all([
    stat(resolve(webRoot, "index.html")),
    stat(resolve(webRoot, "assets")),
  ]);
  assert.ok(index.isFile(), "Stage 9 browser host requires a built SPA index");
  assert.ok(assets.isDirectory(), "Stage 9 browser host requires a built SPA assets directory");
  let apiUpstreamPort: number | null = null;
  let expectedHost = "";

  const server = createServer((incoming, outgoing) => {
    void (async () => {
      let requestUrl: URL;
      try {
        requestUrl = new URL(incoming.url ?? "/", `http://${expectedHost}`);
      } catch {
        outgoing.writeHead(400, { "cache-control": "no-store" }).end();
        return;
      }
      if (requestUrl.host !== expectedHost) {
        outgoing.writeHead(400, { "cache-control": "no-store" }).end();
        return;
      }

      if (requestUrl.pathname === "/api" || requestUrl.pathname.startsWith("/api/")) {
        if (apiUpstreamPort === null) {
          outgoing.writeHead(503, { "cache-control": "no-store" }).end();
          return;
        }
        const upstream = requestHttp(
          {
            hostname: "127.0.0.1",
            port: apiUpstreamPort,
            path: `${requestUrl.pathname}${requestUrl.search}`,
            method: incoming.method ?? "GET",
            headers: { ...incoming.headers, host: expectedHost },
          },
          (upstreamResponse) => {
            outgoing.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
            upstreamResponse.pipe(outgoing);
          },
        );
        upstream.on("error", () => {
          if (!outgoing.headersSent) {
            outgoing.writeHead(502, { "cache-control": "no-store" });
          }
          outgoing.end();
        });
        incoming.pipe(upstream);
        return;
      }

      if (incoming.method !== "GET" && incoming.method !== "HEAD") {
        outgoing.writeHead(405, { allow: "GET, HEAD", "cache-control": "private, no-store" }).end();
        return;
      }

      let decodedPath: string;
      try {
        decodedPath = decodeURIComponent(requestUrl.pathname);
      } catch {
        outgoing.writeHead(400, { "cache-control": "private, no-store" }).end();
        return;
      }
      if (
        decodedPath !== "/" &&
        (!decodedPath.startsWith("/assets/") ||
          decodedPath
            .split("/")
            .some((segment) => segment === "." || segment === ".." || segment.startsWith(".")))
      ) {
        outgoing.writeHead(404, { "cache-control": "private, no-store" }).end();
        return;
      }

      const assetPath = decodedPath === "/" ? "index.html" : decodedPath.slice(1);
      const filePath = resolve(webRoot, assetPath);
      const relativePath = relative(webRoot, filePath);
      if (
        relativePath.length === 0 ||
        relativePath === ".." ||
        relativePath.startsWith(`..${sep}`)
      ) {
        outgoing.writeHead(404, { "cache-control": "private, no-store" }).end();
        return;
      }

      try {
        const actualPath = await realpath(filePath);
        if (!actualPath.startsWith(`${webRoot}${sep}`)) {
          outgoing.writeHead(404, { "cache-control": "private, no-store" }).end();
          return;
        }
        const metadata = await lstat(actualPath);
        if (!metadata.isFile() || metadata.isSymbolicLink()) {
          outgoing.writeHead(404, { "cache-control": "private, no-store" }).end();
          return;
        }
        const contentType = staticContentTypes[extname(actualPath)];
        if (contentType === undefined) {
          outgoing.writeHead(404, { "cache-control": "private, no-store" }).end();
          return;
        }
        const body = await readFile(actualPath);
        outgoing.writeHead(200, {
          "cache-control": "private, no-store",
          "content-length": body.byteLength,
          "content-type": contentType,
          "x-content-type-options": "nosniff",
        });
        outgoing.end(incoming.method === "HEAD" ? undefined : body);
      } catch {
        outgoing.writeHead(404, { "cache-control": "private, no-store" }).end();
      }
    })().catch(() => {
      if (!outgoing.headersSent) {
        outgoing.writeHead(500, { "cache-control": "private, no-store" });
      }
      outgoing.end();
    });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      server.removeListener("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    throw new Error("Stage 9 built SPA host did not bind a TCP address");
  }
  expectedHost = `${hostname}:${address.port}`;

  return {
    expectedHost,
    origin: `http://${expectedHost}`,
    webRoot,
    setApiUpstreamPort(port) {
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error("Stage 9 API upstream port is invalid");
      }
      apiUpstreamPort = port;
    },
    close: async () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      }),
  };
};

export interface BrowserAccount {
  readonly email: string;
  readonly password: string;
}

export interface StaffBrowserAccount extends BrowserAccount {
  readonly totpSeed: string;
}

export interface Stage9BrowserJourneyInput {
  readonly adminOrigin: string;
  readonly portalOrigin: string;
  readonly staffCookieName: string;
  readonly portalCookieName: string;
  readonly tripId: string;
  readonly workspaceTripTitle: string;
  readonly revisedWorkspaceTripTitle: string;
  readonly publishedSnapshotTitle: string;
  readonly flightTitle: string;
  readonly revisedFlightTitle: string;
  readonly initialAccommodationTitle: string;
  readonly revisedAccommodationTitle: string;
  readonly staff: StaffBrowserAccount;
  readonly authorizedPortal: BrowserAccount;
  readonly ungrantedPortal: BrowserAccount;
  readonly grantCreatedTripAccess: (createdTripId: string) => Promise<void>;
  readonly artifactIdentity?: {
    readonly candidate: string;
    readonly artifactId: string;
    readonly sourceSnapshotSha256: string;
  };
  readonly makeTotpCode: (seed: string) => Promise<string>;
  readonly evidenceDirectory: string;
}

interface BrowserTelemetry {
  axeScans: number;
  consoleErrors: number;
  readonly consoleErrorMessages: string[];
  pageErrors: number;
  sensitiveQueryObserved: boolean;
  expectedHttpResourceErrors: number;
  readonly clientErrors: string[];
  readonly failedRequests: Set<string>;
  readonly serverErrors: Set<string>;
  readonly staticHttpErrors: Set<string>;
  readonly externalOrigins: Set<string>;
  readonly adminApiPaths: Set<string>;
  readonly portalApiPaths: Set<string>;
}

const createTelemetry = (): BrowserTelemetry => ({
  axeScans: 0,
  consoleErrors: 0,
  consoleErrorMessages: [],
  pageErrors: 0,
  sensitiveQueryObserved: false,
  expectedHttpResourceErrors: 0,
  clientErrors: [],
  failedRequests: new Set(),
  serverErrors: new Set(),
  staticHttpErrors: new Set(),
  externalOrigins: new Set(),
  adminApiPaths: new Set(),
  portalApiPaths: new Set(),
});

const observePage = (
  page: Page,
  input: Pick<
    Stage9BrowserJourneyInput,
    "adminOrigin" | "portalOrigin" | "staff" | "authorizedPortal" | "ungrantedPortal"
  >,
  telemetry: BrowserTelemetry,
): void => {
  const originKind = (origin: string): "admin" | "portal" | null =>
    origin === input.adminOrigin ? "admin" : origin === input.portalOrigin ? "portal" : null;
  const inspectUrl = (
    rawUrl: string,
    method: string,
  ): { kind: "admin" | "portal" | null; url: URL | null } => {
    try {
      const url = new URL(rawUrl);
      if (url.origin === "null" || url.protocol === "data:" || url.protocol === "blob:") {
        return { kind: null, url };
      }
      const kind = originKind(url.origin);
      if (kind === null) telemetry.externalOrigins.add(url.origin);
      if (
        [...url.searchParams.keys()].some((key) =>
          /email|password|token|secret|code|cookie|session/iu.test(key),
        )
      ) {
        telemetry.sensitiveQueryObserved = true;
      }
      if (kind !== null && url.pathname.startsWith("/api/")) {
        const routes = kind === "admin" ? telemetry.adminApiPaths : telemetry.portalApiPaths;
        routes.add(`${method} ${url.pathname}`);
      }
      return { kind, url };
    } catch {
      return { kind: null, url: null };
    }
  };

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (
      /^Failed to load resource: the server responded with a status of (?:401|404) \([^)]+\)$/u.test(
        message.text(),
      )
    ) {
      telemetry.expectedHttpResourceErrors += 1;
      return;
    }
    telemetry.consoleErrors += 1;
    let diagnostic = message.text();
    for (const secret of [
      input.staff.email,
      input.staff.password,
      input.staff.totpSeed,
      input.authorizedPortal.email,
      input.authorizedPortal.password,
      input.ungrantedPortal.email,
      input.ungrantedPortal.password,
    ]) {
      if (secret.length > 0) diagnostic = diagnostic.replaceAll(secret, "[REDACTED]");
    }
    telemetry.consoleErrorMessages.push(
      diagnostic
        .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[EMAIL]")
        .replace(/\b[A-Za-z0-9_-]{60,}\b/gu, "[REDACTED]")
        .slice(0, 300),
    );
  });
  page.on("pageerror", () => {
    telemetry.pageErrors += 1;
  });
  page.on("request", (request) => {
    inspectUrl(request.url(), request.method());
  });
  page.on("requestfailed", (request) => {
    const { kind, url } = inspectUrl(request.url(), request.method());
    if (kind !== null && url !== null)
      telemetry.failedRequests.add(
        `${request.method()} ${url.pathname} ${request.failure()?.errorText ?? "unknown"}`,
      );
  });
  page.on("response", (response) => {
    const request = response.request();
    const { kind, url } = inspectUrl(response.url(), request.method());
    if (kind === null || url === null) return;
    if (response.status() >= 400 && response.status() < 500) {
      telemetry.clientErrors.push(`${request.method()} ${url.pathname} ${response.status()}`);
    }
    if (response.status() >= 500)
      telemetry.serverErrors.add(`${response.status()} ${url.pathname}`);
    if (!url.pathname.startsWith("/api/") && response.status() >= 400) {
      telemetry.staticHttpErrors.add(`${response.status()} ${url.pathname}`);
    }
  });
};

const assertAccessible = async (
  page: Page,
  label: string,
  telemetry: BrowserTelemetry,
): Promise<void> => {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  telemetry.axeScans += 1;
  const violations = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.length,
  }));
  assert.equal(violations.length, 0, `${label} has Axe violations: ${JSON.stringify(violations)}`);
};

const assertPageBasics = async (page: Page, label: string): Promise<void> => {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const images = Array.from(document.images);
    await Promise.all(images.map((image) => image.decode().catch(() => undefined)));
  });
  const [brokenImages, fontFamily, dimensions] = await Promise.all([
    page.locator("img").evaluateAll(
      (images) =>
        images.filter((image) => {
          const htmlImage = image as HTMLImageElement;
          return !htmlImage.complete || htmlImage.naturalWidth === 0;
        }).length,
    ),
    page.evaluate(() => getComputedStyle(document.documentElement).fontFamily),
    page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    })),
  ]);
  assert.equal(brokenImages, 0, `${label} contains a broken image`);
  assert.match(
    fontFamily,
    /ui-sans-serif.*system-ui.*sans-serif/iu,
    `${label} must retain the local system-font fallback stack`,
  );
  assert.ok(
    dimensions.documentWidth <= dimensions.viewportWidth + 1,
    `${label} overflows horizontally at ${dimensions.viewportWidth}px`,
  );
};

const assertNoCredentialStorage = async (page: Page, account: BrowserAccount): Promise<void> => {
  const storedCredential = await page.evaluate(({ email, password }) => {
    const storage = [window.localStorage, window.sessionStorage];
    return storage.some((store) => {
      for (let index = 0; index < store.length; index += 1) {
        const key = store.key(index) ?? "";
        const value = store.getItem(key) ?? "";
        if (
          /bearer|access.?token|refresh.?token|password|credential|session.?token/iu.test(key) ||
          value.includes(email) ||
          value.includes(password) ||
          /Bearer\s+[A-Za-z0-9._~-]+/iu.test(value)
        ) {
          return true;
        }
      }
      return false;
    });
  }, account);
  assert.equal(
    storedCredential,
    false,
    "Browser storage contains an account credential or bearer token",
  );
};

const captureScreenshot = async (
  page: Page,
  evidenceDirectory: string,
  filename: string,
): Promise<string> => {
  const screenshotDirectory = resolve(evidenceDirectory, "screenshots");
  await mkdir(screenshotDirectory, { recursive: true, mode: 0o700 });
  await chmod(screenshotDirectory, 0o700);
  const screenshotPath = resolve(screenshotDirectory, filename);
  await page.screenshot({ path: screenshotPath, fullPage: true, animations: "disabled" });
  await chmod(screenshotPath, 0o600);
  return relative(evidenceDirectory, screenshotPath);
};

export const runStage9BrowserJourney = async (
  input: Stage9BrowserJourneyInput,
): Promise<{
  readonly screenshotCount: number;
  readonly axeScanCount: number;
  readonly createdTripId: string;
  readonly createdFlightId: string;
  readonly createdAccommodationId: string;
  readonly workspaceRevisions: readonly string[];
}> => {
  const evidenceDirectory = resolve(input.evidenceDirectory);
  await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
  await chmod(evidenceDirectory, 0o700);
  const telemetry = createTelemetry();
  const screenshots: string[] = [];
  const workspaceRevisions: string[] = [];
  let createdTripId = "";
  let createdFlightId: string;
  let createdAccommodationId: string;
  const expectedOrigins = new Set([input.adminOrigin, input.portalOrigin]);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

  try {
    const resolverRules = [...expectedOrigins]
      .map((origin) => `MAP ${new URL(origin).hostname} 127.0.0.1`)
      .join(",");
    browser = await chromium.launch({
      headless: true,
      args: [`--host-resolver-rules=${resolverRules}`, "--no-proxy-server"],
    });
    const context = await browser.newContext({
      colorScheme: "light",
      deviceScaleFactor: 1,
      locale: "pt-PT",
      reducedMotion: "reduce",
      timezoneId: "Europe/Lisbon",
      viewport: { width: 1280, height: 900 },
    });
    const adminPage = await context.newPage();
    adminPage.setDefaultTimeout(15_000);
    observePage(adminPage, input, telemetry);

    const adminResponse = await adminPage.goto(input.adminOrigin, { waitUntil: "networkidle" });
    assert.equal(adminResponse?.status(), 200, "Admin production SPA did not return HTTP 200");
    await browserExpect(adminPage.getByRole("heading", { name: "Entrar na equipa" })).toBeVisible();
    await assertPageBasics(adminPage, "Admin login");
    await assertAccessible(adminPage, "Admin login", telemetry);
    assert.equal(new URL(adminPage.url()).search, "", "Admin login URL contains a query string");

    await adminPage.getByLabel("Email profissional").fill(input.staff.email);
    await adminPage.getByLabel("Palavra-passe").fill(input.staff.password);
    await adminPage.getByRole("button", { name: "Entrar", exact: true }).click();
    await browserExpect(
      adminPage.getByRole("heading", { name: "Confirmar identidade" }),
    ).toBeVisible();
    await adminPage
      .getByLabel("Código de autenticação")
      .fill(await input.makeTotpCode(input.staff.totpSeed));
    await adminPage.getByRole("button", { name: "Confirmar", exact: true }).click();
    await browserExpect(adminPage.getByRole("heading", { name: "Visão geral" })).toBeVisible();
    const recentTrips = adminPage
      .getByRole("region", { name: "Viagens recentes" })
      .getByRole("list", { name: "Viagens" });
    await browserExpect(recentTrips.getByRole("listitem").first()).toBeVisible();
    await assertNoCredentialStorage(adminPage, input.staff);
    await assertPageBasics(adminPage, "Admin overview");
    await assertAccessible(adminPage, "Admin overview", telemetry);
    screenshots.push(
      await captureScreenshot(adminPage, evidenceDirectory, "admin-overview-desktop-1280.png"),
    );

    const staffCookies = await context.cookies(input.adminOrigin);
    const staffCookie = staffCookies.find((cookie) => cookie.name === input.staffCookieName);
    assert.ok(staffCookie, "Staff session cookie was not established");
    assert.equal(staffCookie.httpOnly, true, "Staff session cookie is not HttpOnly");
    assert.equal(
      (await context.cookies(input.portalOrigin)).some(
        (cookie) => cookie.name === input.staffCookieName,
      ),
      false,
      "Staff session cookie crossed into the Portal origin",
    );
    assert.equal(
      new URL(adminPage.url()).search,
      "",
      "Admin authenticated URL contains a query string",
    );

    await adminPage
      .getByRole("navigation", { name: "Navegação principal" })
      .getByRole("link", { name: "Viagens", exact: true })
      .click();
    await browserExpect(
      adminPage.getByRole("heading", { name: "Viagens", exact: true }),
    ).toBeVisible();
    await browserExpect(
      adminPage.getByRole("link", { name: /^Abrir viagem:/u }).first(),
    ).toBeVisible();
    await browserExpect(
      adminPage.getByRole("button", { name: "Nova viagem", exact: true }),
    ).toBeVisible();
    await assertPageBasics(adminPage, "Admin Trip list");
    await assertAccessible(adminPage, "Admin Trip list", telemetry);
    await adminPage.getByRole("button", { name: "Nova viagem", exact: true }).click();
    const createTripForm = adminPage.getByRole("form", { name: "Nova viagem" });
    await browserExpect(createTripForm).toBeVisible();
    await assertPageBasics(adminPage, "Admin Trip creation form");
    await assertAccessible(adminPage, "Admin Trip creation form", telemetry);
    screenshots.push(
      await captureScreenshot(
        adminPage,
        evidenceDirectory,
        "admin-trip-create-form-desktop-1280.png",
      ),
    );
    await createTripForm.getByLabel("Cliente", { exact: true }).fill("Cliente sintético Stage 9");
    await createTripForm
      .getByLabel("Nome próprio do viajante principal", { exact: true })
      .fill("Viajante");
    await createTripForm
      .getByLabel("Apelido do viajante principal", { exact: true })
      .fill("Sintético");
    await createTripForm
      .getByLabel("Nome da viagem", { exact: true })
      .fill(input.workspaceTripTitle);
    await createTripForm.getByLabel("Data de início", { exact: true }).fill("2026-11-15");
    await createTripForm.getByLabel("Data de fim", { exact: true }).fill("2026-11-16");
    const createTripResponsePromise = adminPage.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/admin/trips/workspace" && response.request().method() === "POST"
      );
    });
    await createTripForm.getByRole("button", { name: "Criar viagem", exact: true }).click();
    const createTripResponse = await createTripResponsePromise;
    assert.equal(createTripResponse.status(), 201, "Admin Trip creation did not return HTTP 201");
    const createdWorkspace = (await createTripResponse.json()) as {
      readonly trip?: {
        readonly id?: string;
        readonly title?: string;
        readonly workspaceRevision?: string;
      };
    };
    const createdTrip = createdWorkspace.trip;
    if (createdTrip === undefined) throw new Error("Admin Trip creation returned no Trip");
    const createdTripResponseId = createdTrip.id;
    if (createdTripResponseId === undefined) {
      throw new Error("Admin Trip creation response omitted the Trip ID");
    }
    assert.match(createdTripResponseId, /^[0-9a-f-]{36}$/iu);
    assert.equal(createdTrip.title, input.workspaceTripTitle);
    const createTripRevision = createdTrip.workspaceRevision;
    assert.equal(createTripRevision, "1");
    if (createTripRevision === undefined) {
      throw new Error("Admin Trip creation response omitted the workspace revision");
    }
    createdTripId = createdTripResponseId;
    workspaceRevisions.push(createTripRevision);
    assert.notEqual(
      createdTripId,
      input.tripId,
      "Created Trip must differ from the ungranted fixture",
    );
    await input.grantCreatedTripAccess(createdTripId);
    await browserExpect(
      adminPage.getByRole("heading", { name: input.workspaceTripTitle }),
    ).toBeVisible();
    await browserExpect(
      adminPage.getByText("Ainda não existem serviços neste itinerário."),
    ).toBeVisible();

    await adminPage.getByRole("button", { name: "Adicionar voo", exact: true }).click();
    const createFlightForm = adminPage.getByRole("form", { name: "Adicionar voo" });
    await browserExpect(createFlightForm).toBeVisible();
    await assertPageBasics(adminPage, "Admin Flight creation form");
    await assertAccessible(adminPage, "Admin Flight creation form", telemetry);
    screenshots.push(
      await captureScreenshot(
        adminPage,
        evidenceDirectory,
        "admin-flight-create-form-desktop-1280.png",
      ),
    );
    await createFlightForm.getByLabel("Título do voo", { exact: true }).fill(input.flightTitle);
    await createFlightForm
      .getByLabel("Transportadora", { exact: true })
      .fill("Companhia sintética");
    await createFlightForm.getByLabel("Número do voo", { exact: true }).fill("SN-901");
    await createFlightForm.getByLabel("Aeroporto de partida (IATA)", { exact: true }).fill("LIS");
    await createFlightForm.getByLabel("Aeroporto de chegada (IATA)", { exact: true }).fill("MAD");
    await createFlightForm
      .getByLabel("Descrição do voo", { exact: true })
      .fill("Voo sintético para acceptance Stage 9.");
    await createFlightForm.getByLabel("Partida — data local", { exact: true }).fill("2026-11-15");
    await createFlightForm.getByLabel("Partida — hora local", { exact: true }).fill("10:00");
    await createFlightForm
      .getByLabel("Partida — fuso horário IANA", { exact: true })
      .fill("Europe/Lisbon");
    await createFlightForm.getByLabel("Chegada — data local", { exact: true }).fill("2026-11-15");
    await createFlightForm.getByLabel("Chegada — hora local", { exact: true }).fill("12:15");
    await createFlightForm
      .getByLabel("Chegada — fuso horário IANA", { exact: true })
      .fill("Europe/Madrid");
    const createFlightResponsePromise = adminPage.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === `/api/admin/trips/${createdTripId}/workspace/flights` &&
        response.request().method() === "POST"
      );
    });
    await createFlightForm.getByRole("button", { name: "Guardar voo", exact: true }).click();
    const createFlightResponse = await createFlightResponsePromise;
    assert.equal(
      createFlightResponse.status(),
      201,
      "Admin Flight creation did not return HTTP 201",
    );
    const workspaceWithFlight = (await createFlightResponse.json()) as {
      readonly trip?: { readonly id?: string; readonly workspaceRevision?: string };
      readonly flights?: readonly { readonly id?: string; readonly title?: string }[];
      readonly accommodations?: readonly unknown[];
    };
    const flightWorkspaceTrip = workspaceWithFlight.trip;
    if (flightWorkspaceTrip === undefined) throw new Error("Flight creation returned no Trip");
    assert.equal(flightWorkspaceTrip.id, createdTripId);
    const flightWorkspaceRevision = flightWorkspaceTrip.workspaceRevision;
    assert.equal(flightWorkspaceRevision, "2");
    if (flightWorkspaceRevision === undefined) {
      throw new Error("Flight creation response omitted the workspace revision");
    }
    assert.equal(workspaceWithFlight.flights?.length, 1);
    assert.equal(workspaceWithFlight.accommodations?.length, 0);
    const createdFlight = workspaceWithFlight.flights?.find(
      (flight) => flight.title === input.flightTitle,
    );
    if (createdFlight?.id === undefined) {
      throw new Error("Admin Flight creation response omitted the created Flight ID");
    }
    createdFlightId = createdFlight.id;
    workspaceRevisions.push(flightWorkspaceRevision);
    await browserExpect(
      adminPage.getByRole("button", { name: `Editar voo: ${input.flightTitle}`, exact: true }),
    ).toBeVisible();
    await adminPage.getByRole("button", { name: "Adicionar alojamento", exact: true }).click();
    const createAccommodationForm = adminPage.getByRole("form", { name: "Adicionar alojamento" });
    await browserExpect(createAccommodationForm).toBeVisible();
    await assertPageBasics(adminPage, "Admin Accommodation creation form");
    await assertAccessible(adminPage, "Admin Accommodation creation form", telemetry);
    await createAccommodationForm
      .getByLabel("Título do alojamento", { exact: true })
      .fill(input.initialAccommodationTitle);
    await createAccommodationForm
      .getByLabel("Estabelecimento", { exact: true })
      .fill("Estabelecimento sintético Stage 9");
    await createAccommodationForm
      .getByLabel("Descrição do alojamento", { exact: true })
      .fill("Alojamento sintético para acceptance v1.");
    await createAccommodationForm
      .getByLabel("Check-in — data local", { exact: true })
      .fill("2026-11-15");
    await createAccommodationForm
      .getByLabel("Check-in — hora local", { exact: true })
      .fill("15:00");
    await createAccommodationForm
      .getByLabel("Check-in — fuso horário IANA", { exact: true })
      .fill("Europe/Lisbon");
    await createAccommodationForm
      .getByLabel("Check-out — data local", { exact: true })
      .fill("2026-11-16");
    await createAccommodationForm
      .getByLabel("Check-out — hora local", { exact: true })
      .fill("11:00");
    await createAccommodationForm
      .getByLabel("Check-out — fuso horário IANA", { exact: true })
      .fill("Europe/Lisbon");
    const createAccommodationResponsePromise = adminPage.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === `/api/admin/trips/${createdTripId}/workspace/accommodations` &&
        response.request().method() === "POST"
      );
    });
    await createAccommodationForm
      .getByRole("button", { name: "Guardar alojamento", exact: true })
      .click();
    const createAccommodationResponse = await createAccommodationResponsePromise;
    assert.equal(
      createAccommodationResponse.status(),
      201,
      "Admin Accommodation creation did not return HTTP 201",
    );
    const workspaceWithAccommodation = (await createAccommodationResponse.json()) as {
      readonly trip?: { readonly id?: string; readonly workspaceRevision?: string };
      readonly flights?: readonly { readonly id?: string; readonly title?: string }[];
      readonly accommodations?: readonly { readonly id?: string; readonly title?: string }[];
    };
    const accommodationWorkspaceTrip = workspaceWithAccommodation.trip;
    if (accommodationWorkspaceTrip === undefined) {
      throw new Error("Accommodation creation returned no Trip");
    }
    assert.equal(accommodationWorkspaceTrip.id, createdTripId);
    const accommodationWorkspaceRevision = accommodationWorkspaceTrip.workspaceRevision;
    assert.equal(accommodationWorkspaceRevision, "3");
    if (accommodationWorkspaceRevision === undefined) {
      throw new Error("Accommodation creation response omitted the workspace revision");
    }
    assert.equal(workspaceWithAccommodation.flights?.length, 1);
    assert.equal(
      workspaceWithAccommodation.flights?.some((flight) => flight.title === input.flightTitle),
      true,
    );
    assert.equal(workspaceWithAccommodation.accommodations?.length, 1);
    const createdAccommodation = workspaceWithAccommodation.accommodations?.find(
      (accommodation) => accommodation.title === input.initialAccommodationTitle,
    );
    if (createdAccommodation?.id === undefined) {
      throw new Error("Admin Accommodation creation response omitted the created item ID");
    }
    createdAccommodationId = createdAccommodation.id;
    workspaceRevisions.push(accommodationWorkspaceRevision);
    await browserExpect(
      adminPage.getByRole("button", {
        name: `Editar alojamento: ${input.initialAccommodationTitle}`,
        exact: true,
      }),
    ).toBeVisible();
    await adminPage.getByRole("button", { name: "Pré-visualizar publicação", exact: true }).click();
    await browserExpect(
      adminPage.getByRole("heading", { name: "Pré-visualização — ainda não publicada" }),
    ).toBeVisible();
    await browserExpect(
      adminPage
        .locator(".admin-preview")
        .getByText(input.initialAccommodationTitle, { exact: true }),
    ).toBeVisible();
    await browserExpect(
      adminPage.locator(".admin-preview").getByText(input.flightTitle, { exact: true }),
    ).toBeVisible();
    await assertPageBasics(adminPage, "Admin v1 publication preview");
    await assertAccessible(adminPage, "Admin v1 publication preview", telemetry);
    screenshots.push(
      await captureScreenshot(
        adminPage,
        evidenceDirectory,
        "admin-publication-v1-preview-desktop-1280.png",
      ),
    );
    await adminPage.getByRole("button", { name: "Publicar versão", exact: true }).click();
    await browserExpect(adminPage.getByText("Versão 1 publicada", { exact: true })).toBeVisible();
    await browserExpect(adminPage.getByText("Versão 1 · Ativa", { exact: true })).toBeVisible();
    const adminBody = await adminPage.locator("body").innerText();
    assert.equal(
      adminBody.includes("INTERNAL_ONLY"),
      false,
      "Admin workspace exposed an internal-only sentinel",
    );
    await assertPageBasics(adminPage, "Admin Trip detail");
    await assertAccessible(adminPage, "Admin Trip detail", telemetry);
    screenshots.push(
      await captureScreenshot(adminPage, evidenceDirectory, "admin-trip-detail-desktop-1280.png"),
    );
    const adminReloadResponse = await adminPage.reload({ waitUntil: "networkidle" });
    assert.equal(
      adminReloadResponse?.status(),
      200,
      "Direct Admin detail reload did not return HTTP 200",
    );
    await browserExpect(
      adminPage.getByRole("heading", { name: input.workspaceTripTitle }),
    ).toBeVisible();
    await browserExpect(
      adminPage.getByRole("button", { name: `Editar voo: ${input.flightTitle}`, exact: true }),
    ).toBeVisible();

    for (const width of [768, 390, 320]) {
      await adminPage.setViewportSize({ width, height: 844 });
      await assertPageBasics(adminPage, `Admin Trip detail ${width}px`);
    }
    await adminPage.setViewportSize({ width: 390, height: 844 });
    const adminMenuButton = adminPage.locator(".workspace-mobile-toggle");
    await browserExpect(adminMenuButton).toBeVisible();
    await adminMenuButton.click();
    await browserExpect(adminMenuButton).toHaveAttribute("aria-expanded", "true");
    await browserExpect(adminPage.locator(".workspace-mobile-nav")).toBeVisible();
    await assertAccessible(adminPage, "Admin mobile navigation open", telemetry);
    await adminPage.keyboard.press("Escape");
    await browserExpect(adminPage.getByRole("button", { name: "Abrir navegação" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await browserExpect(adminPage.getByRole("button", { name: "Abrir navegação" })).toBeFocused();
    await browserExpect(adminPage.locator(".workspace-mobile-nav")).toHaveCount(0);
    await adminPage.getByRole("button", { name: "Abrir navegação" }).click();
    await adminPage
      .locator(".workspace-mobile-nav")
      .getByRole("link", { name: "Viagens", exact: true })
      .click();
    await browserExpect(
      adminPage.getByRole("heading", { name: "Viagens", exact: true }),
    ).toBeVisible();
    await browserExpect(adminPage.locator(".workspace-mobile-nav")).toHaveCount(0);
    await assertPageBasics(adminPage, "Admin mobile Trip list");
    screenshots.push(
      await captureScreenshot(adminPage, evidenceDirectory, "admin-trip-list-mobile-390.png"),
    );

    const portalPage = await context.newPage();
    portalPage.setDefaultTimeout(15_000);
    observePage(portalPage, input, telemetry);
    const portalResponse = await portalPage.goto(input.portalOrigin, { waitUntil: "networkidle" });
    assert.equal(portalResponse?.status(), 200, "Portal production SPA did not return HTTP 200");
    await browserExpect(
      portalPage.getByRole("heading", { name: "Entrar no Portal" }),
    ).toBeVisible();
    await assertPageBasics(portalPage, "Portal login");
    await assertAccessible(portalPage, "Portal login", telemetry);
    assert.equal(new URL(portalPage.url()).search, "", "Portal login URL contains a query string");
    assert.equal(
      (await context.cookies(input.portalOrigin)).some(
        (cookie) => cookie.name === input.portalCookieName,
      ),
      false,
      "Portal session existed before Portal authentication",
    );

    await portalPage.getByLabel("Email", { exact: true }).fill(input.authorizedPortal.email);
    await portalPage.getByLabel("Palavra-passe").fill(input.authorizedPortal.password);
    await portalPage.getByRole("button", { name: "Entrar", exact: true }).click();
    await browserExpect(
      portalPage.getByRole("heading", { name: "As minhas viagens" }),
    ).toBeVisible();
    await browserExpect(
      portalPage.getByRole("link", {
        name: `Abrir itinerário: ${input.publishedSnapshotTitle}`,
        exact: true,
      }),
    ).toBeVisible();
    await assertNoCredentialStorage(portalPage, input.authorizedPortal);
    await assertPageBasics(portalPage, "Portal authorized Trip list");
    await assertAccessible(portalPage, "Portal authorized Trip list", telemetry);
    screenshots.push(
      await captureScreenshot(portalPage, evidenceDirectory, "portal-trip-list-desktop-1280.png"),
    );

    const portalCookies = await context.cookies(input.portalOrigin);
    const portalCookie = portalCookies.find((cookie) => cookie.name === input.portalCookieName);
    assert.ok(portalCookie, "Portal session cookie was not established");
    assert.equal(portalCookie.httpOnly, true, "Portal session cookie is not HttpOnly");
    assert.equal(
      portalCookies.some((cookie) => cookie.name === input.staffCookieName),
      false,
      "Staff session cookie crossed into the Portal origin",
    );
    assert.equal(
      (await context.cookies(input.adminOrigin)).some(
        (cookie) => cookie.name === input.portalCookieName,
      ),
      false,
      "Portal session cookie crossed into the Staff origin",
    );

    await portalPage
      .getByRole("link", {
        name: `Abrir itinerário: ${input.publishedSnapshotTitle}`,
        exact: true,
      })
      .click();
    await browserExpect(
      portalPage.getByRole("heading", { name: input.publishedSnapshotTitle }),
    ).toBeVisible();
    await browserExpect(
      portalPage.getByRole("heading", { name: input.initialAccommodationTitle, exact: true }),
    ).toBeVisible();
    await browserExpect(
      portalPage.getByRole("heading", { name: input.flightTitle, exact: true }),
    ).toBeVisible();
    const portalBody = await portalPage.locator("body").innerText();
    assert.equal(
      portalBody.includes(input.revisedAccommodationTitle),
      false,
      "Portal exposed the unpublished Accommodation revision",
    );
    assert.equal(
      portalBody.includes("INTERNAL_ONLY"),
      false,
      "Portal exposed an internal-only sentinel",
    );
    await assertPageBasics(portalPage, "Portal published snapshot detail");
    await assertAccessible(portalPage, "Portal published snapshot detail", telemetry);
    await adminPage.setViewportSize({ width: 1280, height: 900 });
    await adminPage
      .getByRole("link", {
        name: `Abrir viagem: ${input.workspaceTripTitle}`,
        exact: true,
      })
      .click();
    await browserExpect(
      adminPage.getByRole("heading", { name: input.workspaceTripTitle, exact: true }),
    ).toBeVisible();
    await adminPage
      .getByRole("button", {
        name: `Editar alojamento: ${input.initialAccommodationTitle}`,
        exact: true,
      })
      .click();
    const editAccommodationForm = adminPage.getByRole("form", {
      name: `Editar alojamento: ${input.initialAccommodationTitle}`,
    });
    await browserExpect(editAccommodationForm).toBeVisible();
    await assertPageBasics(adminPage, "Admin Accommodation edit form");
    await assertAccessible(adminPage, "Admin Accommodation edit form", telemetry);
    await editAccommodationForm
      .getByLabel("Título do alojamento", { exact: true })
      .fill(input.revisedAccommodationTitle);
    await editAccommodationForm
      .getByLabel("Estabelecimento", { exact: true })
      .fill("Estabelecimento sintético Stage 9 revisto");
    await editAccommodationForm
      .getByLabel("Descrição do alojamento", { exact: true })
      .fill("Alojamento sintético para acceptance v2.");
    const updateAccommodationResponsePromise = adminPage.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname ===
          `/api/admin/trips/${createdTripId}/workspace/accommodations/${createdAccommodationId}` &&
        response.request().method() === "PATCH"
      );
    });
    await editAccommodationForm
      .getByRole("button", { name: "Guardar alojamento", exact: true })
      .click();
    const updateAccommodationResponse = await updateAccommodationResponsePromise;
    assert.equal(
      updateAccommodationResponse.status(),
      200,
      "Admin Accommodation update did not return HTTP 200",
    );
    const workspaceAfterAccommodationEdit = (await updateAccommodationResponse.json()) as {
      readonly trip?: {
        readonly id?: string;
        readonly title?: string;
        readonly workspaceRevision?: string;
        readonly lockVersion?: string;
      };
      readonly flights?: readonly { readonly id?: string; readonly title?: string }[];
      readonly accommodations?: readonly { readonly id?: string; readonly title?: string }[];
    };
    const editedWorkspaceTrip = workspaceAfterAccommodationEdit.trip;
    if (editedWorkspaceTrip === undefined) throw new Error("Accommodation update returned no Trip");
    assert.equal(editedWorkspaceTrip.id, createdTripId);
    const editedWorkspaceRevision = editedWorkspaceTrip.workspaceRevision;
    assert.equal(editedWorkspaceRevision, "4");
    if (editedWorkspaceRevision === undefined) {
      throw new Error("Accommodation update response omitted the workspace revision");
    }
    assert.equal(
      workspaceAfterAccommodationEdit.flights?.some((flight) => flight.title === input.flightTitle),
      true,
    );
    assert.equal(
      workspaceAfterAccommodationEdit.accommodations?.some(
        (accommodation) => accommodation.title === input.revisedAccommodationTitle,
      ),
      true,
    );
    workspaceRevisions.push(editedWorkspaceRevision);
    await browserExpect(
      adminPage.getByRole("button", {
        name: `Editar alojamento: ${input.revisedAccommodationTitle}`,
        exact: true,
      }),
    ).toBeVisible();

    await adminPage.getByRole("button", { name: "Editar viagem", exact: true }).click();
    const editTripForm = adminPage.getByRole("form", { name: "Editar dados da viagem" });
    await browserExpect(editTripForm).toBeVisible();
    await assertPageBasics(adminPage, "Admin Trip edit form");
    await assertAccessible(adminPage, "Admin Trip edit form", telemetry);
    screenshots.push(
      await captureScreenshot(
        adminPage,
        evidenceDirectory,
        "admin-trip-edit-form-desktop-1280.png",
      ),
    );
    await editTripForm
      .getByLabel("Nome da viagem", { exact: true })
      .fill(input.revisedWorkspaceTripTitle);
    const updateTripResponsePromise = adminPage.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === `/api/admin/trips/${createdTripId}/workspace` &&
        response.request().method() === "PATCH"
      );
    });
    await editTripForm.getByRole("button", { name: "Guardar viagem", exact: true }).click();
    const updateTripResponse = await updateTripResponsePromise;
    assert.equal(updateTripResponse.status(), 200, "Admin Trip update did not return HTTP 200");
    const workspaceAfterTripEdit = (await updateTripResponse.json()) as {
      readonly trip?: {
        readonly id?: string;
        readonly title?: string;
        readonly workspaceRevision?: string;
      };
      readonly flights?: readonly {
        readonly id?: string;
        readonly title?: string;
        readonly lockVersion?: string;
      }[];
    };
    const tripAfterEdit = workspaceAfterTripEdit.trip;
    if (tripAfterEdit === undefined) throw new Error("Trip update returned no Trip");
    assert.equal(tripAfterEdit.id, createdTripId);
    assert.equal(tripAfterEdit.title, input.revisedWorkspaceTripTitle);
    if (editedWorkspaceTrip.lockVersion === undefined) {
      throw new Error("Accommodation update response omitted the Trip lock version");
    }
    const tripUpdatePayload = updateTripResponse.request().postDataJSON() as {
      readonly expectedLockVersion?: string;
      readonly expectedWorkspaceRevision?: string;
    };
    assert.equal(tripUpdatePayload.expectedWorkspaceRevision, editedWorkspaceRevision);
    assert.equal(tripUpdatePayload.expectedLockVersion, editedWorkspaceTrip.lockVersion);
    const tripEditWorkspaceRevision = tripAfterEdit.workspaceRevision;
    assert.equal(tripEditWorkspaceRevision, "5");
    if (tripEditWorkspaceRevision === undefined) {
      throw new Error("Trip update response omitted the workspace revision");
    }
    assert.equal(
      workspaceAfterTripEdit.flights?.some((flight) => flight.title === input.flightTitle),
      true,
    );
    workspaceRevisions.push(tripEditWorkspaceRevision);
    await browserExpect(
      adminPage.getByRole("heading", { name: input.revisedWorkspaceTripTitle, exact: true }),
    ).toBeVisible();
    await browserExpect(
      adminPage.getByRole("button", { name: `Editar voo: ${input.flightTitle}`, exact: true }),
    ).toBeVisible();
    const flightBeforeEdit = workspaceAfterTripEdit.flights?.find(
      (flight) => flight.id === createdFlightId,
    );
    if (flightBeforeEdit?.lockVersion === undefined) {
      throw new Error("Trip update response omitted the Flight lock version");
    }

    await adminPage
      .getByRole("button", { name: `Editar voo: ${input.flightTitle}`, exact: true })
      .click();
    const editFlightForm = adminPage.getByRole("form", {
      name: `Editar voo: ${input.flightTitle}`,
    });
    await browserExpect(editFlightForm).toBeVisible();
    await assertPageBasics(adminPage, "Admin Flight edit form");
    await assertAccessible(adminPage, "Admin Flight edit form", telemetry);
    screenshots.push(
      await captureScreenshot(
        adminPage,
        evidenceDirectory,
        "admin-flight-edit-form-desktop-1280.png",
      ),
    );
    await editFlightForm
      .getByLabel("Título do voo", { exact: true })
      .fill(input.revisedFlightTitle);
    const updateFlightResponsePromise = adminPage.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === `/api/admin/trips/${createdTripId}/workspace/flights/${createdFlightId}` &&
        response.request().method() === "PATCH"
      );
    });
    await editFlightForm.getByRole("button", { name: "Guardar voo", exact: true }).click();
    const updateFlightResponse = await updateFlightResponsePromise;
    assert.equal(updateFlightResponse.status(), 200, "Admin Flight update did not return HTTP 200");
    const workspaceAfterFlightEdit = (await updateFlightResponse.json()) as {
      readonly trip?: {
        readonly id?: string;
        readonly title?: string;
        readonly workspaceRevision?: string;
      };
      readonly flights?: readonly { readonly id?: string; readonly title?: string }[];
      readonly accommodations?: readonly { readonly id?: string; readonly title?: string }[];
    };
    const tripAfterFlightEdit = workspaceAfterFlightEdit.trip;
    if (tripAfterFlightEdit === undefined) throw new Error("Flight update returned no Trip");
    assert.equal(tripAfterFlightEdit.id, createdTripId);
    assert.equal(tripAfterFlightEdit.title, input.revisedWorkspaceTripTitle);
    const flightUpdatePayload = updateFlightResponse.request().postDataJSON() as {
      readonly expectedLockVersion?: string;
      readonly expectedWorkspaceRevision?: string;
    };
    assert.equal(flightUpdatePayload.expectedWorkspaceRevision, tripEditWorkspaceRevision);
    assert.equal(flightUpdatePayload.expectedLockVersion, flightBeforeEdit.lockVersion);
    const flightEditWorkspaceRevision = tripAfterFlightEdit.workspaceRevision;
    assert.equal(flightEditWorkspaceRevision, "6");
    if (flightEditWorkspaceRevision === undefined) {
      throw new Error("Flight update response omitted the workspace revision");
    }
    assert.equal(
      workspaceAfterFlightEdit.flights?.some(
        (flight) => flight.id === createdFlightId && flight.title === input.revisedFlightTitle,
      ),
      true,
    );
    assert.equal(
      workspaceAfterFlightEdit.accommodations?.some(
        (accommodation) => accommodation.title === input.revisedAccommodationTitle,
      ),
      true,
    );
    workspaceRevisions.push(flightEditWorkspaceRevision);
    await browserExpect(
      adminPage.getByRole("button", {
        name: `Editar voo: ${input.revisedFlightTitle}`,
        exact: true,
      }),
    ).toBeVisible();

    const portalReloadResponse = await portalPage.reload({ waitUntil: "networkidle" });
    assert.equal(
      portalReloadResponse?.status(),
      200,
      "Direct Portal snapshot reload did not return HTTP 200",
    );
    await browserExpect(
      portalPage.getByRole("heading", { name: input.publishedSnapshotTitle }),
    ).toBeVisible();
    await browserExpect(
      portalPage.getByRole("heading", { name: input.initialAccommodationTitle, exact: true }),
    ).toBeVisible();
    await browserExpect(
      portalPage.getByRole("heading", { name: input.flightTitle, exact: true }),
    ).toBeVisible();
    await browserExpect(
      portalPage.getByRole("heading", { name: input.revisedAccommodationTitle, exact: true }),
    ).toHaveCount(0);
    await browserExpect(
      portalPage.getByRole("heading", { name: input.revisedWorkspaceTripTitle, exact: true }),
    ).toHaveCount(0);
    await browserExpect(
      portalPage.getByRole("heading", { name: input.revisedFlightTitle, exact: true }),
    ).toHaveCount(0);
    screenshots.push(
      await captureScreenshot(
        portalPage,
        evidenceDirectory,
        "portal-trip-detail-v1-after-workspace-edit-desktop-1280.png",
      ),
    );

    await adminPage.getByRole("button", { name: "Pré-visualizar publicação", exact: true }).click();
    await browserExpect(
      adminPage.getByRole("heading", { name: "Pré-visualização — ainda não publicada" }),
    ).toBeVisible();
    await browserExpect(
      adminPage
        .locator(".admin-preview")
        .getByText(input.revisedAccommodationTitle, { exact: true }),
    ).toBeVisible();
    await browserExpect(
      adminPage.locator(".admin-preview").getByText(input.revisedFlightTitle, { exact: true }),
    ).toBeVisible();
    await assertAccessible(adminPage, "Admin v2 publication preview", telemetry);
    await adminPage.getByRole("button", { name: "Publicar versão", exact: true }).click();
    await browserExpect(adminPage.getByText("Versão 2 publicada", { exact: true })).toBeVisible();
    await browserExpect(adminPage.getByText("Versão 2 · Ativa", { exact: true })).toBeVisible();
    await browserExpect(adminPage.getByText("Versão 1 · Anterior", { exact: true })).toBeVisible();

    const portalV2ReloadResponse = await portalPage.reload({ waitUntil: "networkidle" });
    assert.equal(
      portalV2ReloadResponse?.status(),
      200,
      "Portal v2 snapshot reload did not return HTTP 200",
    );
    await browserExpect(
      portalPage.getByRole("heading", { name: input.revisedWorkspaceTripTitle, exact: true }),
    ).toBeVisible();
    await browserExpect(
      portalPage.getByRole("heading", { name: input.revisedAccommodationTitle, exact: true }),
    ).toBeVisible();
    await browserExpect(
      portalPage.getByRole("heading", { name: input.revisedFlightTitle, exact: true }),
    ).toBeVisible();
    await browserExpect(
      portalPage.getByRole("heading", { name: input.initialAccommodationTitle, exact: true }),
    ).toHaveCount(0);
    await browserExpect(
      portalPage.getByRole("heading", { name: input.flightTitle, exact: true }),
    ).toHaveCount(0);
    await assertPageBasics(portalPage, "Portal published snapshot v2");
    await assertAccessible(portalPage, "Portal published snapshot v2", telemetry);
    screenshots.push(
      await captureScreenshot(
        portalPage,
        evidenceDirectory,
        "portal-trip-detail-v2-desktop-1280.png",
      ),
    );

    for (const width of [768, 390, 320]) {
      await portalPage.setViewportSize({ width, height: 844 });
      await assertPageBasics(portalPage, `Portal snapshot detail ${width}px`);
    }
    await portalPage.setViewportSize({ width: 390, height: 844 });
    const portalMenuButton = portalPage.locator(".workspace-mobile-toggle");
    await browserExpect(portalMenuButton).toBeVisible();
    await portalMenuButton.click();
    await browserExpect(portalMenuButton).toHaveAttribute("aria-expanded", "true");
    await browserExpect(portalPage.locator(".workspace-mobile-nav")).toBeVisible();
    await assertAccessible(portalPage, "Portal mobile navigation open", telemetry);
    await portalPage.keyboard.press("Escape");
    await browserExpect(
      portalPage.getByRole("button", { name: "Abrir navegação" }),
    ).toHaveAttribute("aria-expanded", "false");
    await browserExpect(portalPage.getByRole("button", { name: "Abrir navegação" })).toBeFocused();
    await browserExpect(portalPage.locator(".workspace-mobile-nav")).toHaveCount(0);
    await portalPage.getByRole("button", { name: "Abrir navegação" }).click();
    await portalPage
      .locator(".workspace-mobile-nav")
      .getByRole("link", { name: "As minhas viagens", exact: true })
      .click();
    await browserExpect(
      portalPage.getByRole("heading", { name: "As minhas viagens" }),
    ).toBeVisible();
    await browserExpect(portalPage.locator(".workspace-mobile-nav")).toHaveCount(0);
    await assertPageBasics(portalPage, "Portal mobile Trip list");
    screenshots.push(
      await captureScreenshot(portalPage, evidenceDirectory, "portal-trip-list-mobile-390.png"),
    );

    const portalLogoutSessionPromise = portalPage.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/portal/session-context" && response.request().method() === "GET"
      );
    });
    await portalPage.getByRole("button", { name: "Terminar sessão" }).click();
    await browserExpect(
      portalPage.getByRole("heading", { name: "Entrar no Portal" }),
    ).toBeVisible();
    const portalLogoutSession = await portalLogoutSessionPromise;
    assert.equal(portalLogoutSession.status(), 401, "Portal session remained valid after sign-out");
    assert.equal(
      (await context.cookies(input.portalOrigin)).some(
        (cookie) => cookie.name === input.portalCookieName,
      ),
      false,
      "Portal sign-out did not remove the Portal session cookie",
    );
    assert.equal(
      (await context.cookies(input.adminOrigin)).some(
        (cookie) => cookie.name === input.staffCookieName,
      ),
      true,
      "Portal sign-out unexpectedly removed the separate Staff session",
    );

    await portalPage.getByLabel("Email", { exact: true }).fill(input.ungrantedPortal.email);
    await portalPage.getByLabel("Palavra-passe").fill(input.ungrantedPortal.password);
    await portalPage.getByRole("button", { name: "Entrar", exact: true }).click();
    await browserExpect(
      portalPage.getByRole("heading", { name: "As minhas viagens" }),
    ).toBeVisible();
    await browserExpect(
      portalPage.getByText("Não tem viagens disponíveis neste momento."),
    ).toBeVisible();
    await assertNoCredentialStorage(portalPage, input.ungrantedPortal);
    await assertPageBasics(portalPage, "Portal ungranted Trip list");
    await assertAccessible(portalPage, "Portal ungranted Trip list", telemetry);

    const deniedResponsePromise = portalPage.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === `/api/portal/trips/${input.tripId}`;
    });
    await portalPage.evaluate((tripId) => {
      window.location.hash = `#/trips/${encodeURIComponent(tripId)}`;
    }, input.tripId);
    const deniedResponse = await deniedResponsePromise;
    assert.equal(
      deniedResponse.status(),
      404,
      "Un-granted Portal detail did not fail closed with HTTP 404",
    );
    await browserExpect(
      portalPage.getByRole("heading", { name: "Esta viagem não está disponível." }),
    ).toBeVisible();
    const deniedBody = await portalPage.locator("body").innerText();
    assert.equal(
      deniedBody.includes(input.publishedSnapshotTitle),
      false,
      "Un-granted Portal detail disclosed snapshot data",
    );
    assert.equal(
      deniedBody.includes(input.workspaceTripTitle),
      false,
      "Un-granted Portal detail disclosed workspace data",
    );
    await assertPageBasics(portalPage, "Portal ungranted Trip detail");
    await assertAccessible(portalPage, "Portal ungranted Trip detail", telemetry);

    const ungrantedLogoutSessionPromise = portalPage.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/portal/session-context" && response.request().method() === "GET"
      );
    });
    await portalPage.getByRole("button", { name: "Terminar sessão" }).click();
    await browserExpect(
      portalPage.getByRole("heading", { name: "Entrar no Portal" }),
    ).toBeVisible();
    assert.equal(
      (await ungrantedLogoutSessionPromise).status(),
      401,
      "Un-granted Portal session remained valid after sign-out",
    );
    const adminLogoutSessionPromise = adminPage.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/staff/session-context" && response.request().method() === "GET";
    });
    await adminPage.getByRole("button", { name: "Terminar sessão" }).click();
    await browserExpect(adminPage.getByRole("heading", { name: "Entrar na equipa" })).toBeVisible();
    assert.equal(
      (await adminLogoutSessionPromise).status(),
      401,
      "Staff session remained valid after sign-out",
    );
    assert.equal(
      (await context.cookies(input.adminOrigin)).some(
        (cookie) => cookie.name === input.staffCookieName,
      ),
      false,
      "Staff sign-out did not remove the Staff session cookie",
    );

    const expectedClientErrorResponses = new Set([
      "GET /api/staff/session-context 401",
      "GET /api/portal/session-context 401",
      `GET /api/portal/trips/${input.tripId} 404`,
    ]);
    const unexpectedClientErrors = telemetry.clientErrors.filter(
      (error) => !expectedClientErrorResponses.has(error),
    );
    assert.deepEqual(
      [...new Set(unexpectedClientErrors)].sort(),
      [],
      "Browser observed unexpected API client-error responses",
    );
    assert.deepEqual(
      [...expectedClientErrorResponses].filter((error) => !telemetry.clientErrors.includes(error)),
      [],
      "Browser did not observe every expected authorization response",
    );
    assert.equal(
      telemetry.expectedHttpResourceErrors >= expectedClientErrorResponses.size,
      true,
      "Expected authorization responses were not reflected in browser diagnostics",
    );
    assert.equal(
      telemetry.consoleErrors,
      0,
      `Browser emitted console errors: ${JSON.stringify(telemetry.consoleErrorMessages)}`,
    );
    assert.equal(telemetry.pageErrors, 0, "Browser emitted uncaught page errors");
    assert.deepEqual(
      [...telemetry.failedRequests].sort(),
      [
        "GET /api/staff/session-context net::ERR_ABORTED",
        "GET /api/portal/session-context net::ERR_ABORTED",
        `GET /api/portal/trips/${input.tripId} net::ERR_ABORTED`,
      ].sort(),
      "Browser had unexpected failed or cancelled requests",
    );
    assert.equal(
      telemetry.serverErrors.size,
      0,
      "Browser observed API or static HTTP 5xx responses",
    );
    assert.equal(
      telemetry.staticHttpErrors.size,
      0,
      "Production SPA returned a static asset HTTP error",
    );
    assert.equal(
      telemetry.externalOrigins.size,
      0,
      "Production SPA requested a non-local external origin",
    );
    assert.equal(
      telemetry.sensitiveQueryObserved,
      false,
      "Browser URL contains a credential-like query parameter",
    );
    assert.equal(
      [...telemetry.portalApiPaths].some((route) => route.includes("/api/admin/")),
      false,
      "Portal called an Admin API route",
    );
    assert.equal(
      [...telemetry.adminApiPaths].some((route) => route.includes("/api/portal/")),
      false,
      "Admin called a Portal API route",
    );

    assert.deepEqual(workspaceRevisions, ["1", "2", "3", "4", "5", "6"]);
    const report = {
      schemaVersion: 1,
      result: "PASS",
      scope: input.artifactIdentity
        ? "extracted Stage 9 candidate Admin and Portal SPAs with isolated loopback APIs"
        : "workspace-built Stage 9 Admin and Portal SPAs with isolated loopback APIs",
      artifact: input.artifactIdentity
        ? { source: "EXTRACTED_CANDIDATE", ...input.artifactIdentity }
        : { source: "WORKSPACE_DIST" },
      viewports: [1280, 768, 390, 320],
      journeys: [
        "Staff password login and TOTP MFA",
        "Admin overview, Trip creation and editing with Customer and primary Traveller, Flight and Accommodation creation/edit, and direct Trip detail reload",
        "Admin publication preview, immutable v1/v2 publication history, and stale workspace isolation",
        "Staff edits Trip, Flight, and Accommodation through Admin; Portal v1 remains immutable and v2 appears only after republish",
        "Portal ungranted list denial and direct-detail HTTP 404",
        "Independent Staff and Portal cookies, logout, and browser-storage checks",
        "Mobile navigation open, aria-expanded, Escape close, focus restoration, and link navigation",
      ],
      accessibility: { scans: telemetry.axeScans, violations: 0 },
      workflow: {
        createdTripId,
        createdFlightId,
        createdAccommodationId,
        workspaceRevisions,
        tripCreatedThroughAdminUi: true,
        tripUpdatedThroughAdminUi: true,
        flightCreatedThroughAdminUi: true,
        flightUpdatedThroughAdminUi: true,
        accommodationCreatedThroughAdminUi: true,
      },
      network: {
        consoleErrors: telemetry.consoleErrors,
        expectedHttpResourceErrors: telemetry.expectedHttpResourceErrors,
        clientErrors: [...telemetry.clientErrors].sort(),
        pageErrors: telemetry.pageErrors,
        failedRequests: [...telemetry.failedRequests].sort(),
        serverErrors: [...telemetry.serverErrors].sort(),
        staticHttpErrors: [...telemetry.staticHttpErrors].sort(),
        externalOriginCount: telemetry.externalOrigins.size,
        sensitiveQueryObserved: telemetry.sensitiveQueryObserved,
        adminApiPaths: [...telemetry.adminApiPaths].sort(),
        portalApiPaths: [...telemetry.portalApiPaths].sort(),
      },
      isolation: {
        staffCookieHttpOnly: true,
        portalCookieHttpOnly: true,
        crossRealmCookieLeak: false,
        portalWorkspaceFallback: false,
        portalV1IncludesFlight: true,
        portalV1UnchangedAfterAccommodationEdit: true,
        portalV1UnchangedAfterWorkspaceEdits: true,
        portalV2IncludesFlight: true,
        portalV2IncludesRevisedTripAndFlight: true,
        portalV2VisibleAfterRepublish: true,
        ungrantedTripListEmpty: true,
        ungrantedTripSnapshotStatus: deniedResponse.status(),
      },
      screenshots,
    };
    const reportPath = resolve(evidenceDirectory, "browser-acceptance.json");
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    await chmod(reportPath, 0o600);
    await context.close();
    return {
      screenshotCount: screenshots.length,
      axeScanCount: telemetry.axeScans,
      createdTripId,
      createdFlightId,
      createdAccommodationId,
      workspaceRevisions,
    };
  } finally {
    await browser?.close();
  }
};

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StaffInvitationAcceptView, StaffInvitationsView } from "../src/staff-invitations-view.js";

import {
  acceptAdminStaffInvitation,
  issueAdminStaffInvitation,
  listAdminStaffInvitations,
  revokeAdminStaffInvitation,
  reissueAdminStaffInvitation,
} from "../src/staff-invitation-api.js";

const pendingInvitation = {
  invitationId: "019a0101-0000-7000-8000-000000000003",
  targetEmail: "qa@example.test",
  status: "PENDING",
  createdAt: "2026-11-03T15:00:00.000Z",
  expiresAt: "2026-11-03T16:00:00.000Z",
  consumedAt: null,
  revokedAt: null,
};
const syntheticToken = "A".repeat(43);

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Admin Staff invitation API", () => {
  it("loads a bounded page through the same-origin Staff API without exposing a token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [pendingInvitation], nextCursor: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const page = await listAdminStaffInvitations({ limit: 25, cursor: null });

    expect(page).toEqual({ items: [pendingInvitation], nextCursor: null });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/staff/invitations?limit=25",
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" },
      }),
    );
  });

  it("rejects an invitation page that unexpectedly contains a bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        items: [{ ...pendingInvitation, token: syntheticToken }],
        nextCursor: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(listAdminStaffInvitations({ limit: 25, cursor: null })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("issues an invitation with a strict JSON body and returns the one-time handoff", async () => {
    const response = { invitation: pendingInvitation, token: syntheticToken };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(response, 201));
    vi.stubGlobal("fetch", fetchMock);

    await expect(issueAdminStaffInvitation({ targetEmail: "qa@example.test" })).resolves.toEqual(
      response,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/staff/invitations",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ targetEmail: "qa@example.test" }),
      }),
    );
  });

  it("reissues through the invitation-specific POST path and keeps the token out of the URL", async () => {
    const response = { invitation: pendingInvitation, token: syntheticToken };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(response));
    vi.stubGlobal("fetch", fetchMock);

    await expect(reissueAdminStaffInvitation(pendingInvitation.invitationId)).resolves.toEqual(
      response,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/admin/staff/invitations/${pendingInvitation.invitationId}/reissue`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: "{}",
      }),
    );
  });

  it("revokes a pending invitation through its explicit POST transition", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(pendingInvitation));
    vi.stubGlobal("fetch", fetchMock);

    await expect(revokeAdminStaffInvitation(pendingInvitation.invitationId)).resolves.toEqual(
      pendingInvitation,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/admin/staff/invitations/${pendingInvitation.invitationId}/revoke`,
      expect.objectContaining({ method: "POST", credentials: "same-origin", body: "{}" }),
    );
  });

  it("accepts an invitation using only a JSON POST body and handles the empty success response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const input = { token: syntheticToken, name: "QA Staff", password: "synthetic-password" };

    await expect(acceptAdminStaffInvitation(input)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/staff/invitations/accept",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
  });

  it("rejects invalid invitation fields before making a network request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(issueAdminStaffInvitation({ targetEmail: "not-an-email" })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Admin Staff invitation views", () => {
  it("renders the bounded list loading and honest empty states", async () => {
    let resolvePage: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolvePage = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<StaffInvitationsView onAuthenticationRequired={vi.fn()} />);

    expect(screen.getByRole("status")).toHaveTextContent("A carregar os convites…");
    resolvePage?.(jsonResponse({ items: [], nextCursor: null }));
    expect(await screen.findByText("Ainda não existem convites de equipa.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/staff/invitations?limit=25",
      expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store" }),
    );
  });

  it("loads later pages only with the server cursor", async () => {
    const nextCursor = "019a0101-0000-7000-8000-000000000009";
    const secondInvitation = {
      ...pendingInvitation,
      invitationId: "019a0101-0000-7000-8000-000000000008",
      targetEmail: "qa-second@example.test",
      status: "CONSUMED",
      consumedAt: "2026-11-03T15:30:00.000Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [pendingInvitation], nextCursor }))
      .mockResolvedValueOnce(jsonResponse({ items: [secondInvitation], nextCursor: null }));
    vi.stubGlobal("fetch", fetchMock);

    render(<StaffInvitationsView onAuthenticationRequired={vi.fn()} />);
    expect(await screen.findByText("qa@example.test")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais convites" }));

    expect(await screen.findByText("qa-second@example.test")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/admin/staff/invitations?limit=25&cursor=${nextCursor}`,
      expect.objectContaining({ method: "GET", credentials: "same-origin", cache: "no-store" }),
    );
  });

  it("issues and reissues one-time tokens without copying or persisting them", async () => {
    const issued = {
      invitation: pendingInvitation,
      token: syntheticToken,
    };
    let invitationCreated = false;
    const fetchMock = vi.fn().mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/admin/staff/invitations?")) {
        return jsonResponse({
          items: invitationCreated ? [pendingInvitation] : [],
          nextCursor: null,
        });
      }
      if (url === "/api/admin/staff/invitations" && init?.method === "POST") {
        invitationCreated = true;
        return jsonResponse(issued, 201);
      }
      if (url.endsWith("/reissue") && init?.method === "POST") {
        return jsonResponse({ ...issued, token: "B".repeat(43) });
      }
      throw new Error(`Unexpected Staff invitation request: ${url} ${init?.method ?? ""}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    window.localStorage.clear();

    render(<StaffInvitationsView onAuthenticationRequired={vi.fn()} />);
    await screen.findByText("Ainda não existem convites de equipa.");
    const form = screen.getByRole("form", { name: "Emitir convite para Staff" });
    expect(form).toHaveAttribute("method", "post");
    expect(form).toHaveAttribute("action", "/api/admin/staff/invitations");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Email profissional"), {
      target: { value: "qa@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Emitir convite" }));

    expect(await screen.findByLabelText("Token de utilização única")).toHaveValue(syntheticToken);
    expect(
      screen.getByText(
        "Acesso fixo Trip Operations. A função não pode ser alterada neste formulário.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir aceitação do convite" })).toHaveAttribute(
      "href",
      "#/staff/invitations/accept",
    );
    expect(window.localStorage.length).toBe(0);
    expect(window.location.href).not.toContain(syntheticToken);

    fireEvent.click(screen.getByRole("button", { name: "Fechar e apagar o token" }));
    expect(screen.queryByLabelText("Token de utilização única")).not.toBeInTheDocument();
    expect(await screen.findByText("qa@example.test")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reemitir token" }));
    expect(confirm).toHaveBeenCalled();
    expect(await screen.findByLabelText("Token de utilização única")).toHaveValue("B".repeat(43));
    expect(window.location.href).not.toContain("B".repeat(43));
  });

  it("revokes a pending invitation only after confirmation", async () => {
    const revokedInvitation = {
      ...pendingInvitation,
      status: "REVOKED",
      revokedAt: "2026-11-03T15:45:00.000Z",
    };
    const fetchMock = vi.fn().mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/admin/staff/invitations?")) {
        return jsonResponse({ items: [pendingInvitation], nextCursor: null });
      }
      if (url.endsWith("/revoke") && init?.method === "POST") {
        return jsonResponse(revokedInvitation);
      }
      throw new Error(`Unexpected Staff invitation request: ${url} ${init?.method ?? ""}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<StaffInvitationsView onAuthenticationRequired={vi.fn()} />);
    expect(await screen.findByText("qa@example.test")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Revogar convite" }));
    expect(confirm).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Por aceitar")).toBeInTheDocument();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Revogar convite" }));
    expect(await screen.findByText("Revogado")).toBeInTheDocument();
  });

  it("accepts an invitation through a public POST form with no credential-bearing URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.clear();

    render(<StaffInvitationAcceptView />);

    const form = screen.getByRole("form", { name: "Aceitar convite de Staff" });
    expect(form).toHaveAttribute("method", "post");
    expect(form).toHaveAttribute("action", "/api/staff/invitations/accept");
    fireEvent.change(screen.getByLabelText("Código do convite"), {
      target: { value: syntheticToken },
    });
    fireEvent.change(screen.getByLabelText("Nome completo"), {
      target: { value: "QA Staff" },
    });
    fireEvent.change(screen.getByLabelText("Criar palavra-passe"), {
      target: { value: "synthetic-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Aceitar convite" }));

    expect(await screen.findByRole("heading", { name: "Convite aceite" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/staff/invitations/accept",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          token: syntheticToken,
          name: "QA Staff",
          password: "synthetic-password",
        }),
      }),
    );
    expect(window.location.href).not.toContain(syntheticToken);
    expect(window.location.href).not.toContain("synthetic-password");
    expect(window.localStorage.length).toBe(0);
  });
});

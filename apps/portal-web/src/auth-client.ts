import { createAuthClient } from "better-auth/react";

export const portalAuthClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: "/api/auth/portal",
  fetchOptions: { credentials: "same-origin" },
});

import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

export interface StaffTwoFactorChallenge {
  readonly methods: readonly string[];
}

let pendingTwoFactorChallenge: StaffTwoFactorChallenge | null = null;

export const resetStaffTwoFactorChallenge = (): void => {
  pendingTwoFactorChallenge = null;
};

export const consumeStaffTwoFactorChallenge = (): StaffTwoFactorChallenge | null => {
  const challenge = pendingTwoFactorChallenge;
  pendingTwoFactorChallenge = null;
  return challenge;
};

export const staffAuthClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: "/api/auth/staff",
  fetchOptions: { credentials: "same-origin" },
  plugins: [
    twoFactorClient({
      onTwoFactorRedirect: ({ twoFactorMethods }) => {
        pendingTwoFactorChallenge = { methods: twoFactorMethods ?? [] };
      },
    }),
  ],
});

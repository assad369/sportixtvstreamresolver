import type { NextAuthConfig } from "next-auth";

// Kept minimal: real route protection lives in the Data Access Layer
// (lib/auth-guard.ts) per the Next 16 auth guidance, not the `authorized`
// callback. This just sets the sign-in page.
export const authConfig = {
  pages: {
    signIn: "/login",
  },
  providers: [],
} satisfies NextAuthConfig;

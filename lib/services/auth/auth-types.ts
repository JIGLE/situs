// Module augmentation for NextAuth's Session, User and JWT. Nothing imports this file: tsc picks
// it up through tsconfig's `include`, so an import-graph sweep reports it as dead. Deleting it
// untypes `session.user.id` and `.role` everywhere — `npm run type-check` is what notices.
declare module "next-auth" {
  interface Session {
    expires: string;
    /**
     * The language the account chose, read at sign-in (`auth.ts`). Absent when the account never
     * chose one: `LanguageSync` then leaves the device on its own language.
     */
    locale?: import("@/lib/i18n/config").Locale;
    user: {
      id: string;
      role: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }

  interface User {
    id: string;
    role: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: string;
  }
}

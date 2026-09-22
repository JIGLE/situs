# Dev Auth Setup Guide

This guide explains how to use dev auth for local testing without a database.

## Overview

Dev auth mode (`NEXT_PUBLIC_DEV_AUTH=true`) provides a complete development experience without requiring a running database. It automatically authenticates as `dev@example.local` with admin privileges.

### When to Use Dev Auth

- **Local development**: Quick UI testing without database setup
- **E2E testing**: Pre-authenticated sessions for Playwright tests
- **Component testing**: Testing features that require authentication
- **Demo purposes**: Show features without login overhead

### When NOT to Use Dev Auth

- Production deployments (will be ignored)
- Testing real authentication flows (use demo credentials instead)
- Testing database operations (use real database)

## Setup

### 1. Create `.env.local` in Project Root

```env
NODE_ENV=development
NEXT_PUBLIC_DEV_AUTH=true
NEXTAUTH_SECRET=my-secret-key-at-least-32-characters
```

### 2. Start the Development Server

```bash
npm run dev
```

No database required. The app will start on `http://localhost:3000`.

### 3. Verify Dev Auth is Active

Open the browser console and run:

```javascript
// Check client-side session
const { data: session } = await useSession();
console.log(session);
// Should output: { user: { id: "dev-user", email: "dev@example.local", name: "Dev User", role: "ADMIN" }, ... }
```

Navigate to any protected page (e.g., `/dashboard`) — you should be automatically logged in without the login page.

## How It Works

### Client-Side Session

- DevAuthProvider (in app layout) injects a dev session into React Context
- Session persisted in `sessionStorage` and survives page refresh
- Auto-extends 24 hours on page focus (simulates real JWT strategy)

### Server-Side API Routes

- requireAuth middleware checks `isDevAuthEnabled()`
- If enabled, skips database lookup and accepts dev session
- Dev session user ID: `"dev-user"`, email: `"dev@example.local"`

### No Database Required

- All database queries are bypassed when dev auth is enabled
- Mock data returned for endpoints that need it
- Safe for testing UI without data infrastructure

## Testing with Dev Auth

### Browser Testing

```bash
npm run dev
# Open http://localhost:3000/dashboard
# Should show dashboard without login
```

### Playwright E2E Tests

Dev session is automatically available in E2E tests:

```typescript
// e2e/example.spec.ts
test("authenticated page loads", async ({ page }) => {
  await page.goto("/dashboard");
  // Pre-authenticated — no login required
  await expect(page.getByText("Dev User")).toBeVisible();
});
```

### Unit Tests

Use `SessionProvider` with dev session in component tests:

```typescript
import { SessionProvider } from "next-auth/react";
import { createDevSession } from "@/lib/services/auth/dev-session";

test('component with session', () => {
  const session = createDevSession();
  render(
    <SessionProvider session={session}>
      <MyComponent />
    </SessionProvider>
  );
});
```

## Environment Variables

### Required for Dev Auth to Work

```env
NODE_ENV=development                          # Must be 'development'
NEXT_PUBLIC_DEV_AUTH=true                     # Enable dev auth
NEXTAUTH_SECRET=<32+ random characters>       # JWT signing key
```

### Optional

```env
DATABASE_URL=file:./dev.db                    # Not needed for dev auth
ENABLE_DEMO_LOGIN=true                        # Real login still works alongside dev auth
```

## Troubleshooting

### Dev Auth Not Working After `.env.local` Changes

The dev server may need a restart:

```bash
# Stop the server (Ctrl+C)
npm run dev
```

### Session Expires Too Quickly

Dev session is set to 24 hours. To extend it:

- Focus the browser window (auto-extends)
- Refresh the page (restores from sessionStorage)
- Close the tab to end session

### API Calls Still Returning 401

1. Check that `NODE_ENV=development` in `.env.local`
2. Check that `NEXT_PUBLIC_DEV_AUTH=true` in `.env.local`
3. Restart dev server after changing `.env.local`
4. Verify browser console shows dev session (see Verify step above)

### CSRF Token Errors in Console

This may happen if:

- `/api/csrf-token` endpoint is not working
- CSRF context failed to initialize

Fix: Refresh the page. The CSRF token will be re-fetched.

## Switching Between Dev Auth and Real Auth

You can use both dev auth and demo credentials:

### Dev Auth (Automatic, No Login)

```env
NEXT_PUBLIC_DEV_AUTH=true
NODE_ENV=development
```

- Auto-logged in as dev@example.local
- No login page needed
- Database not required

### Demo Credentials (Login Required)

```env
NEXT_PUBLIC_DEV_AUTH=false
ENABLE_DEMO_LOGIN=true
DATABASE_URL=file:./dev.db  # Required for real auth
```

- See login page
- Use: `demo@situs.local` / `demo123`
- Creates user in database on first login

### Production (No Dev Auth)

```env
NEXT_PUBLIC_DEV_AUTH=false
NODE_ENV=production
DATABASE_URL=<production database>
```

- Real authentication only
- Google OAuth if configured
- No dev auth access

## Architecture Decisions

### Dev Session in sessionStorage (Not localStorage)

- sessionStorage is tied to browser tab/window
- Clears on page close (not persistent across browser restart)
- Safer for development — doesn't pollute user's persistent storage

### 24-Hour Expiry

- Matches real JWT strategy
- Auto-extended on page focus
- Prevents surprise logouts during long dev sessions

### Server-Side Injection

- Dev session injected into next-auth JWT
- API routes see dev session as if user logged in
- No database lookups needed

### No Database Writes

- Dev session is in-memory only
- Safe for testing without affecting real data
- Clean separation: dev auth for UI/test, real auth for data

## See Also

- [NextAuth.js Documentation](https://next-auth.js.org/)
- [App Layout](app/layout.tsx) — where DevAuthProvider is applied
- [Dev Session Factory](lib/services/auth/dev-session.ts) — dev session creation
- [Auth Middleware](lib/services/auth/auth-middleware.ts) — server-side dev auth check

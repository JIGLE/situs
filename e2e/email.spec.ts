import { test, expect } from "@playwright/test";

// These run signed out. The proxy answers every unauthenticated request to a non-public `/api`
// route with 401 before any route runs, so a 401 here pins the refusal, not the route: it cannot
// tell `/api/email` from a path that does not exist. What it does rule out is the status list this
// file used to accept — 404 and 405 included — which passed against `/api/email/send` and
// `/api/email/test`, two routes that were never there.
test.describe("Email endpoints", () => {
  test("sending mail is refused without a session", async ({ request }) => {
    const response = await request.post("/api/email", {
      data: {
        templateId: "rent-reminder",
        recipientEmail: "test@example.com",
        variables: {},
      },
    });

    expect(response.status()).toBe(401);
  });
});

test.describe("Brevo webhook", () => {
  test("refuses a delivery that does not carry the shared secret", async ({ request }) => {
    // Public in the proxy — Brevo does not sign requests, so the shared secret is the only thing
    // in front of this route. 503 while BREVO_WEBHOOK_SECRET is unset (the instance is
    // unconfigured), 401 when it is set and the request lacks it. Either way nothing is recorded.
    const response = await request.post("/api/webhooks/brevo", {
      data: [
        {
          event: "delivered",
          email: "test@example.com",
          timestamp: Date.now(),
        },
      ],
    });

    expect([401, 503]).toContain(response.status());
  });
});

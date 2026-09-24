import { test, expect } from "@playwright/test";

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

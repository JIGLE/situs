# API Routes

This directory contains all API routes for the Situs application using Next.js 16 App Router.

## Structure

```
api/
├── admin/              # Admin operations (database management)
├── analytics/          # Analytics and metrics
├── auth/              # Authentication (NextAuth.js)
├── correspondence/    # Communication and templates
├── debug/             # Debug endpoints (dev only)
├── documents/         # Document management
├── email/             # Email operations
├── expenses/          # Expense tracking
├── health/            # Health check endpoints
├── info/              # API metadata
├── invoices/          # Invoice management
├── leases/            # Lease management
├── maintenance/       # Maintenance requests
├── metrics/           # Application metrics
├── owners/            # Property owner management
├── payments/          # Payment processing
├── properties/        # Property management
├── receipts/          # Receipt management
├── reports/           # Report generation
├── tax/               # Tax compliance (SAF-T PT)
├── tenant-portal/     # Public tenant portal
├── tenants/           # Tenant management
├── units/             # Unit management
├── user/              # User data (GDPR)
└── webhooks/          # External service webhooks
```

## Route Conventions

### File Structure

- `route.ts` - API route handler (GET, POST, PUT, DELETE, etc.)
- `route.test.ts` - Co-located tests for the route
- `[id]/route.ts` - Dynamic route segments

### Route Handlers

All routes export HTTP method handlers:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/services/auth";
import { getPrismaClient } from "@/services/database";

export async function GET(request: NextRequest) {
  const session = await requireAuth(request);
  const prisma = getPrismaClient();

  try {
    const data = await prisma.model.findMany({
      where: { userId: session.user.id },
    });

    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 });
  }
}
```

## Authentication

Most routes require authentication. Use the `requireAuth` middleware:

```typescript
import { requireAuth } from "@/services/auth";

export async function GET(request: NextRequest) {
  const session = await requireAuth(request);
  // session.user contains authenticated user data
}
```

## Validation

Use Zod schemas for input validation:

```typescript
import { z } from "zod";
import { createPropertySchema } from "@/schemas";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const validatedData = createPropertySchema.parse(body);
  // validatedData is type-safe
}
```

## Error Handling

Use consistent error responses:

```typescript
import { ApiError } from "@/utils/errors";

export async function GET(request: NextRequest) {
  try {
    // ... route logic
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

## Rate Limiting

Protected routes automatically apply rate limiting:

```typescript
import { withRateLimit } from "@/utils/rate-limit";

export const GET = withRateLimit(
  async (request: NextRequest) => {
    // Route logic
  },
  {
    limit: 100,
    window: 900000, // 15 minutes
  },
);
```

## CORS Configuration

CORS headers are automatically added by middleware. For specific route configs:

```typescript
export async function GET(request: NextRequest) {
  const response = NextResponse.json({ data });

  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  return response;
}
```

## Database Access

Always use the Prisma client singleton:

```typescript
import { getPrismaClient } from "@/services/database";

export async function GET() {
  const prisma = getPrismaClient();

  // Use prisma client
  const data = await prisma.property.findMany();

  return NextResponse.json({ data });
}
```

## Testing

Write tests for all API routes:

```typescript
// route.test.ts
import { describe, it, expect, vi } from "vitest";
import { GET } from "./route";

describe("GET /api/properties", () => {
  it("should return properties for authenticated user", async () => {
    // Mock authentication
    vi.mock("@/services/auth", () => ({
      requireAuth: vi.fn(() =>
        Promise.resolve({
          user: { id: "user-123" },
        }),
      ),
    }));

    const request = new Request("http://localhost/api/properties");
    const response = await GET(request);

    expect(response.status).toBe(200);
  });
});
```

## Webhooks

Webhook routes should:

1. Verify signatures
2. Handle idempotency
3. Process asynchronously
4. Return quickly (< 5s)

```typescript
import { validateWebhookSignature } from "@/lib/webhooks";

export async function POST(request: NextRequest) {
  // Verify signature
  const signature = request.headers.get("stripe-signature");
  const isValid = await validateWebhookSignature(signature, body);

  if (!isValid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Process webhook asynchronously
  processWebhookAsync(body);

  // Return immediately
  return NextResponse.json({ received: true });
}
```

## Best Practices

1. **Keep routes thin** - Move business logic to services
2. **Use TypeScript** - Leverage type safety
3. **Validate inputs** - Use Zod schemas
4. **Handle errors gracefully** - Provide meaningful error messages
5. **Document routes** - Update API_ROUTES.md when adding routes
6. **Write tests** - Co-locate tests with routes
7. **Use middleware** - For auth, rate limiting, logging
8. **Return consistent formats** - Follow standard response structure
9. **Log appropriately** - Use structured logging
10. **Optimize queries** - Use Prisma's select and include wisely

## Documentation

See [API Routes Documentation](../../docs/architecture/API_ROUTES.md) for complete API reference.

## Environment Variables

Required environment variables for API routes:

- `DATABASE_URL` - PostgreSQL connection string
- `NEXTAUTH_SECRET` - NextAuth.js secret
- `NEXTAUTH_URL` - Application URL
- `SMTP_HOST` - Email service (SMTP relay)
- `STRIPE_SECRET_KEY` - Payment processing (optional)

See `.env.example` for complete list.

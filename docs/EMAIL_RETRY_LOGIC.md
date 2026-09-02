# Email Retry Logic Documentation

## Overview

The Situs email service implements robust retry logic with exponential backoff to handle transient failures and ensure email delivery reliability.

## Configuration

### Default Settings

```typescript
const DEFAULT_RETRY_CONFIG = {
  maxRetries: 3, // Maximum retry attempts
  baseDelayMs: 1000, // Initial retry delay (1 second)
  maxDelayMs: 30000, // Maximum retry delay (30 seconds)
  backoffMultiplier: 2, // Exponential multiplier
};
```

### Custom Configuration

You can override the default configuration when initializing the email service:

```typescript
const emailService = EmailService.getInstance({
  maxRetries: 5,
  baseDelayMs: 2000,
  maxDelayMs: 60000,
  backoffMultiplier: 3,
});
```

## Retry Behavior

### Exponential Backoff Formula

```
delay = baseDelayMs * (backoffMultiplier ^ attempt) + jitter
capped_delay = min(delay, maxDelayMs)
```

### Example Retry Delays (Default Config)

| Attempt | Base Delay | With Jitter (±10%) | Actual Delay |
| ------- | ---------- | ------------------ | ------------ |
| 1       | 1000ms     | 900-1100ms         | ~1s          |
| 2       | 2000ms     | 1800-2200ms        | ~2s          |
| 3       | 4000ms     | 3600-4400ms        | ~4s          |

**Total retry time**: ~7 seconds before final failure

### Jitter

A random jitter of ±10% is added to prevent thundering herd problems when multiple email requests fail simultaneously.

## Retryable Errors

The service automatically retries on:

- **Rate Limits**: `429 Too Many Requests`
- **Timeouts**: Connection timeouts, read timeouts
- **Temporary Server Errors**: `502 Bad Gateway`, `503 Service Unavailable`
- **Network Errors**: `ECONNRESET`, `ENOTFOUND`

### Non-Retryable Errors

Permanent failures that won't retry:

- `400 Bad Request` - Invalid email format
- `401 Unauthorized` - Invalid API key
- `404 Not Found` - Invalid template ID
- Validation errors

## Monitoring

### Email Log

All email attempts (successful and failed) are logged to the database:

```prisma
model EmailLog {
  id          String   @id @default(cuid())
  to          String
  from        String
  subject     String
  templateId  String?
  status      String   // 'sent', 'delivered', 'bounced', 'failed'
  messageId   String?
  retryCount  Int      @default(0)
  error       String?
  sentAt      DateTime @default(now())
  userId      String
}
```

### Retry Count Tracking

The `retryCount` field indicates how many attempts were made:

- `0` = First attempt succeeded
- `1` = Failed once, succeeded on retry
- `3` = Maximum retries exhausted (final failure)

## Usage Examples

### Basic Email Send (with automatic retries)

```typescript
const result = await emailService.sendEmail(
  {
    to: "tenant@example.com",
    from: "landlord@situs.app",
    subject: "Rent Reminder",
    html: "<p>Your rent is due...</p>",
  },
  userId,
);

if (result.success) {
  console.log(`Email sent after ${result.attempts} attempts`);
} else {
  console.error(`Email failed after ${result.attempts} attempts: ${result.error}`);
}
```

### Skip Retries (critical/time-sensitive emails)

```typescript
const result = await emailService.sendEmail(
  emailData,
  userId,
  { skipRetry: true }, // Only attempt once
);
```

## Production Recommendations

### Provider send limits

The app sends over SMTP, so the ceiling is whatever your provider allows rather than anything
Situs enforces. For the ones worth considering:

| Provider                       | Free tier                                       |
| ------------------------------ | ----------------------------------------------- |
| Brevo (default suggestion, EU) | 300/day                                         |
| Resend                         | 3,000/month, 100/day                            |
| MailerSend                     | 3,000/month                                     |
| Amazon SES                     | none — ~€0.10 per 1,000                         |
| SendGrid                       | **none.** Retired July 2025; $19.95/month floor |

For context on whether this matters: a landlord with ten units sends on the order of tens of
emails a month. Every free tier above is one to two orders of magnitude clear of that. If you
are close to a cap, the retry logic below is not your problem — your send volume is.

### Monitoring Setup

1. **Track retry rates**: High retry rates indicate infrastructure issues
2. **Alert on failures**: Set up alerts for retry exhaustion
3. **Monitor latency**: Track p99 send times including retries

### Environment Variables

```bash
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=your-login
SMTP_PASS=your-smtp-key
FROM_EMAIL=noreply@yourdomain.com
```

## Troubleshooting

### High retry rates

**Symptoms**: most emails need two or more attempts.

**Causes**: network instability; provider degradation; hitting a send limit.

**Solutions**: increase `baseDelayMs` to space retries out; queue sends; check your provider's
dashboard for a daily cap you are bumping against.

### Retry exhaustion

**Symptoms**: emails consistently fail after three retries.

**Causes**: wrong credentials (`SMTP_USER` / `SMTP_PASS`); an unverified sending domain; the
wrong port or TLS mode; invalid recipient addresses.

Two that bite specifically on SMTP and produce confusing symptoms:

- **`FROM_EMAIL` on an unverified domain.** Providers reject the envelope rather than the
  connection, so the credentials look fine and every send fails.
- **Port and TLS mismatch.** 465 is implicit TLS; 587 and 25 start plaintext and upgrade via
  STARTTLS. The transport derives this from the port for exactly this reason — a mismatch
  hangs until timeout rather than reporting an error.

**Solutions**: verify the sending domain with your provider, including SPF and DKIM records;
confirm host, port and credentials; validate recipient addresses before sending.

## Testing

### Unit Test Example

```typescript
describe("Email Retry Logic", () => {
  it("should retry on rate limit errors", async () => {
    // Mock the transport to fail twice, then succeed
    const sendStub = jest
      .fn()
      .mockRejectedValueOnce(new Error("Rate limit exceeded"))
      .mockRejectedValueOnce(new Error("429"))
      .mockResolvedValueOnce({ messageId: "test-123" });

    const result = await emailService.sendEmail(emailData, userId);

    expect(sendStub).toHaveBeenCalledTimes(3);
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(3);
  });
});
```

## Performance Impact

### Worst Case Scenario

With default config (3 retries):

- **Best case**: 0ms retry delay (first attempt succeeds)
- **Average case**: ~3.5s additional latency (1-2 retries)
- **Worst case**: ~7s total retry time before final failure

### Recommendations

- For user-facing sends (e.g., password resets): Consider `skipRetry` for faster failure
- For background sends (e.g., bulk notifications): Use default retry config
- For critical sends (e.g., payment confirmations): Increase `maxRetries` to 5

## Version History

- **v0.8.x**: Enhanced retry logic with jitter and improved error detection
- **v0.7.x**: Initial exponential backoff implementation
- **v0.6.x**: Basic retry (linear delay)

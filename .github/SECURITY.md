# Security Policy

## Supported Versions

| Version  | Supported          |
| -------- | ------------------ |
| Latest   | :white_check_mark: |
| < Latest | :x:                |

Only the latest release on `main` receives security updates. We recommend always running the most recent version.

## Reporting a Vulnerability

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, open a private advisory on the
[Security Advisories](https://github.com/JIGLE/situs/security/advisories/new) tab, which lets us
work on a fix together before public disclosure. Include:

- Description of the vulnerability
- Steps to reproduce
- Affected versions
- Potential impact

## Response Timeline

| Stage                        | Target                 |
| ---------------------------- | ---------------------- |
| Acknowledgment               | 48 hours               |
| Initial assessment           | 5 business days        |
| Patch release (critical)     | 7 days                 |
| Patch release (high)         | 14 days                |
| Patch release (moderate/low) | Next scheduled release |

## Scope

The following are in scope for security reports:

- Authentication and authorization bypasses
- Injection vulnerabilities (SQL, XSS, command injection)
- Sensitive data exposure (credentials, PII leaks)
- Server-side request forgery (SSRF)
- Insecure direct object references
- Security misconfigurations in default deployment

The following are **out of scope**:

- Issues in development-only dependencies
- Vulnerabilities requiring physical access
- Social engineering attacks
- Denial of service (unless trivially exploitable)

## Security Measures

This project implements the following security controls:

- **CI/CD**: Automated security scanning via CodeQL, TruffleHog, dependency review, npm audit, and a custom security scanner (see `scripts/security-scan.js`)
- **Dependencies**: Dependabot opens update pull requests; nothing merges them automatically
- **Runtime**: CSP headers with nonce-based script loading, CSRF protection, rate limiting
- **Authentication**: NextAuth.js with short-lived JWT sessions

For operational security details, see [docs/SECURITY.md](../docs/SECURITY.md).

## Disclosure Policy

We follow coordinated disclosure. Once a fix is available, we will:

1. Release a patched version
2. Publish a GitHub Security Advisory
3. Credit the reporter (unless anonymity is requested)

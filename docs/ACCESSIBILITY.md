# Accessibility

Patterns to follow when building a surface, and how the automated check runs.

This replaces three earlier documents (`ACCESSIBILITY_IMPROVEMENTS.md`,
`ACCESSIBILITY_QUICK_REFERENCE.md`, `ACCESSIBILITY_TESTING.md`). The first was a point-in-time
record of one pass — a files-modified list and a score — which git history holds better than a
document does. The third told you to `npm install -D @axe-core/playwright` and write a spec;
both shipped some time ago, and its example was weaker than the spec that actually runs.

**Target: WCAG 2.1 AA.**

## The automated check

`e2e/situs-a11y.spec.ts` runs `@axe-core/playwright` over the Situs workflow surfaces (bank
movements, rent ledger, receipts, tax, OCR review). It is part of the Playwright suite:

```bash
npm run test:e2e -- situs-a11y
```

Its policy, which is stricter than the one the old testing doc proposed:

```typescript
const results = await new AxeBuilder({ page })
  .withTags(["wcag2a", "wcag2aa"])
  .exclude("iframe")
  .analyze();

// critical AND serious fail the test; moderate and minor are reported, not blocking
const blocking = results.violations.filter(
  (v) => v.impact === "critical" || v.impact === "serious",
);
```

Blocking on critical _and_ serious, with moderate/minor advisory, is the same ratchet the colour
token linter uses: tighten as violations are cleared rather than gating everything on day one.

Two things it does not cover, so do not read a green run as "the app is accessible":

- **Scope.** It walks the Situs workflow surfaces, not every page. Pre-existing surfaces have
  their own baseline.
- **Kind.** Axe finds machine-detectable violations — a missing label, a contrast failure. It
  cannot tell you a focus order is illogical or that an announcement is confusing. Those need a
  keyboard and a screen reader.

## Patterns

### Forms — label every input

```tsx
// ✅
<Label htmlFor="email">Email</Label>
<Input id="email" type="email" />

// ❌ not associated: clicking the label does nothing, screen readers announce nothing
<label>Email</label>
<Input type="email" />
```

### Icon-only buttons need a name

```tsx
// ✅ aria-label
<Button aria-label="Close dialog"><X /></Button>

// ✅ or visually-hidden text
<Button><X /><span className="sr-only">Close</span></Button>
```

`Button` also enforces a 44×44px hit area below `md` (`max-md:min-h-11`), so an icon button is
reachable on a phone without a separate rule — see the responsive rules in `CLAUDE.md`.

### Loading states announce themselves

```tsx
<div role="status" aria-live="polite">
  <Spinner aria-hidden="true" />
  <span className="sr-only">Loading data…</span>
</div>
```

### Handled for you

- **Toasts** — `success()` is `role="status" aria-live="polite"`; `error()` is `role="alert"
aria-live="assertive"`. Nothing to add.
- **Modals** — Radix supplies `role="dialog"`, `aria-modal`, focus trapping and restore. Give
  every `DialogContent` a `DialogTitle`; that is what `aria-labelledby` points at.
- **Skip link and `<main>` landmark** — already in the root layout.

## Colour contrast

WCAG AA thresholds: **4.5:1** normal text, **3:1** large text (18pt+) and UI components.

Use the design tokens rather than picking a colour — the palette was chosen to clear these, and
`npm run lint:colors` checks that components use tokens instead of raw values. A new colour that
has not been contrast-checked is the usual way this regresses.

## Manual checks

Axe cannot judge these; they take a few minutes per new surface.

- **Keyboard only.** Tab through it. Every interactive element reachable, focus always visible,
  order matching the visual layout, `Esc` closing overlays, no trap outside a modal.
- **Screen reader.** VoiceOver (`Cmd+F5`) on macOS, NVDA on Windows. Headings should describe
  the page, form errors should be announced when they appear, and a dialog should announce its
  title on open.
- **Zoom to 200%.** Nothing clipped, nothing overlapping, no horizontal scroll on the page body
  — the same rule the mobile audit enforces at 390px.

## Common findings

| Axe says                      | Fix                                                            |
| ----------------------------- | -------------------------------------------------------------- |
| Form input has no label       | `<Label htmlFor>` matching the input's `id`                    |
| Button has no accessible name | `aria-label`, or `sr-only` text beside the icon                |
| Insufficient colour contrast  | Use a design token; do not hand-pick a hex                     |
| No main landmark              | Already in the root layout — a report means a page bypassed it |

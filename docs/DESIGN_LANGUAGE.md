# Design Language

What Situs looks like, in one page, and which test refuses each way of drifting from it. The rules
for building screens (page types, mobile behaviour, the PR checklist) are in
[UI_CONSISTENCY_GUIDE.md](UI_CONSISTENCY_GUIDE.md); this page is the vocabulary those rules draw from.

The voice is a private ledger: square, ruled, mono for labels, one accent. A screen is built from
a small set of parts, and each part has one implementation. A rule here that no test enforces drifts
within a month, so every row below names its guard, and `tests/design-language-contract.test.ts`
fails when a row names a guard that does not exist or a design guard is missing from this page.

## The parts

| Part         | Rule                                                                                                          | Implementation                                               | Guard                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------ |
| Geometry     | Square and flat: no `rounded-*` but `rounded-full`, no shadows, no press-scale. Depth is a border.            | `--radius-*` are 0; the PWA banner is the one shadow         | `tests/flat-geometry-contract.test.ts`     |
| Page heading | One `h1` per screen, from `PageHeader`; the mobile top bar is not a heading.                                  | `components/shared/page-header.tsx`                          | `tests/page-header-contract.test.ts`       |
| Panel        | A bordered section with an `h2`; a warning or danger panel changes its border, not its fill.                  | `components/shared/panel.tsx`                                | `tests/panel-and-tab-contract.test.ts`     |
| Tabs         | One tab style, one bar in Settings and Administration; the bar collapses only when its labels do not fit.     | `components/ui/tabs.tsx` (`TabNav`, `TabLink`)               | `tests/panel-and-tab-contract.test.ts`     |
| State        | A state is a square dot and its name in mono capitals, in the foreground colour; one file maps value to tone. | `components/ui/status-mark.tsx`, `lib/utils/status-tone.ts`  | `tests/status-mark-contract.test.ts`       |
| Lease card   | The card shows the lease, not a placeholder; search, filter and view toggle are one row.                      | `components/features/lease/leases-view.tsx`                  | `tests/lease-card-contract.test.ts`        |
| Colour       | A token, never a palette name; `dark:` is not needed because the tokens follow the theme.                     | `--semantic-*`, `--color-*` in `app/globals.css`             | `tests/colour-and-type-contract.test.ts`   |
| Type         | Six named sizes below the headings (`text-label` … `text-tick`); no arbitrary pixel size.                     | `@utility text-*` in `app/globals.css`, `lib/utils/utils.ts` | `tests/colour-and-type-contract.test.ts`   |
| Overlays     | Full-bleed below `md`, a side panel or dialog above; one surface, no blur.                                    | `components/ui/sheet.tsx`, `dialog.tsx`                      | `tests/overlay-surface-contract.test.ts`   |
| Viewport     | A page shell is `dvh`, never `vh`.                                                                            | `min-h-dvh`, `h-dvh`                                         | `tests/viewport-units-contract.test.ts`    |
| Theme        | The first paint already has the right theme, from the cookie, with no inline-script dependency.               | `app/layout.tsx`, `lib/theme/`                               | `tests/theme-first-paint-contract.test.ts` |
| Sign-in      | The server renders the form; no spinner interstitial; no `min-h-screen`.                                      | `components/features/auth/`                                  | `tests/auth-page-contract.test.ts`         |
| Legal pages  | Follow the app's theme and the URL's language.                                                                | `app/[locale]/terms`, `privacy`                              | `tests/legal-pages-theme-contract.test.ts` |

## What is measured, not asserted

`npm run audit:local` opens every owner-facing page in light and dark at 390px and counts touch
targets under 44px, clipped containers, page overflow and text under 12px. CI runs it as a blocking
ratchet against `BASELINE` in `scripts/mobile-audit.mjs`; a number never goes up.

## Adding to the language

A new part is a component, a row in the table above, and a guard that was put back and watched to
fail. A guard that is too narrow reports clean while the defect ships, so prove it against the
defect it describes before relying on it.

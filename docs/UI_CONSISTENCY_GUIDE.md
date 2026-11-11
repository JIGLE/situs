# UI Consistency Guide

This document defines the **non-negotiable rules** for all UI development in Situs. Engineers must pass this checklist before any UI PR is merged.

The vocabulary these rules draw from, and the test behind each part, is in [DESIGN_LANGUAGE.md](DESIGN_LANGUAGE.md).

---

## Information Architecture

The navigation lives in code, not in this guide: `lib/portal/access.ts` holds the routes, the nav
groups and the redirects from retired paths.

**Rules:**

- ❌ **NEVER** add a new top-level sidebar item without removing or merging another
- ❌ **NEVER** exceed 3 levels of navigation depth — use a modal or drawer for anything deeper
- ✅ New features must fit into existing sections

---

## Page Types

### 1. Dashboard Page

**Purpose:** High-level overview with actionable insights

**Required Sections:**

- Header: Title + date range selector (if applicable)
- KPI Row: one row, 3–4 metrics at most (`CLAUDE.md`, screen density)
- Attention Panel: Items requiring action
- Quick Actions: Primary CTAs

**Forbidden:**

- ❌ Data tables with >10 rows (use "View All" link)
- ❌ Forms (use dialogs)
- ❌ Multiple date range selectors

### 2. List View Page

**Purpose:** Browse, search, and manage multiple entities

**Required Sections:**

- Header: `<PageHeader>` with title + primary "Add" action
- Toolbar: Search + filters + view toggle + bulk actions
- Content: Sortable table/card grid
- Pagination: If >25 items
- Empty State: `<EmptyState>` when no data

**Required Features:**

- ✅ Search input (if >10 items)
- ✅ Sortable columns
- ✅ Pagination (25/50/100)
- ✅ Mobile card view (<768px)

**Forbidden:**

- ❌ More than 5 visible filter options
- ❌ Inline editing of complex fields
- ❌ Nested tables

### 3. Detail View Page

**Purpose:** View and edit single entity with related data

**Required Sections:**

- Header: Entity name + breadcrumb + status + Edit/Delete actions
- Tabs: 3-6 tabs for different aspects
- Content: Tab-specific content

**Forbidden:**

- ❌ Mixing read-only and edit mode in same view
- ❌ More than 6 tabs
- ❌ Forms that navigate away

### 4. Form Page

**Purpose:** Create or modify entity

**When to Use:**

- **Dialog:** <8 fields, quick action
- **Page:** 8-15 fields, needs context
- **Sheet:** a form that makes more than one record, or has more than 8 fields

**Required:**

- ✅ Zod schema validation
- ✅ Inline field errors
- ✅ Loading state on submit
- ✅ Cancel button that returns to origin

### 5. Sheet Form

**Purpose:** One job that touches several records, on one screen. The New tenancy sheet
(`components/features/lease/tenancy-sheet.tsx`) makes the tenant and the lease together.

**Required:**

- ✅ Every field on one scrolling body; the header and the submit stay in view
- ✅ What can wait (documents, numbers a later step asks for, notes) behind one fold
- ✅ Smart defaults the owner checks instead of types
- ✅ Errors in the user's language beside the field, and a fold that holds one opens

**Rules:**

- ❌ No steps: a Next button only hides fields the owner has to come back for
- ❌ No draft persistence: a sheet short enough to finish needs none

---

## Component Usage

### Page Header

```tsx
import { PageHeader } from "@/components/shared/page-header";

<PageHeader title={t("title")} description={t("description")}>
  <Button onClick={handleAdd}>
    <Plus className="h-4 w-4" />
    {t("add")}
  </Button>
</PageHeader>;
```

Actions go in `children`. `PageHeader` writes the screen's `h1`, and a main screen writes no other
(`tests/page-header-contract.test.ts` names the exceptions). Below `md` the mobile top bar already
names the screen, so the title is read by a screen reader only and the visible header shrinks to
the actions; pass `titleOnMobile` for a title that says more than the bar, as the dashboard's
greeting does. One heading per screen: a tab's view does not repeat the page title (`CLAUDE.md`,
screen density).

### Panel

```tsx
import { Panel } from "@/components/shared/panel";

<Panel title={t("title")} description={t("description")} padded>
  {/* the body */}
</Panel>;
```

Settings and Administration draw every panel with `Panel`: an `h2` under the page's `h1`, a ruled
header, a line under it, a body. `tone="warning"` or `tone="danger"` carries the meaning in the
border (Delete account is a `danger` panel of its own). Leave `title` out only where a tab already
names the panel. A tab bar is `TabsList` for tabs that swap a panel and `TabNav` with `TabLink` for
tabs that are pages, both from `components/ui/tabs.tsx`; the style is written there and nowhere
else (`tests/panel-and-tab-contract.test.ts`).

### Status

```tsx
import { StatusMark } from "@/components/ui/status-mark";
import { leaseStatus } from "@/lib/utils/status-tone";

<StatusMark {...leaseStatus(lease.status)}>{tLease(lease.status)}</StatusMark>;
```

A state is a `StatusMark`: a dot in the state's colour and its name in plain small type. Which
tone a stored value takes is decided in `lib/utils/status-tone.ts` and nowhere else; add a state
there, not in a screen. `Badge` is for a label that is not a state (a count, a flag), and has no
success, warning or danger variant (`tests/status-mark-contract.test.ts`).

### Empty State

```tsx
import { EmptyState } from "@/components/ui/loading-state";

<EmptyState
  icon={<Building2 className="h-12 w-12" />}
  title={t("emptyTitle")}
  description={t("emptyDescription")}
  action={<Button onClick={handleAdd}>{t("add")}</Button>}
/>;
```

### Form Dialog (Simple Forms)

```tsx
import { useFormDialog } from "@/lib/hooks/use-form-dialog";

const dialog = useFormDialog<FormData>({
  schema: zodSchema,
  initialData: defaultValues,
  onSubmit: async (data, isEdit) => {
    /* save */
  },
  successMessage: { create: "Created!", update: "Updated!" },
});
```

### Sheet Form (Several Records)

`components/ui/sheet.tsx` with `side="center"`: full-screen below `md`, a centred panel above.
The form owns its state and checks it on submit; see `tenancy-sheet.tsx`.

---

## Action Button Hierarchy

### Positioning

1. **Primary action:** Top-right, blue solid button
2. **Secondary actions:** Top-right, outline buttons
3. **Row actions:** Inline icons or dropdown menu
4. **Bulk actions:** Sticky bar when items selected

### Colors

- **Primary:** Blue solid (`variant="default"`)
- **Secondary:** Gray outline (`variant="outline"`)
- **Destructive:** Red outline (`variant="destructive"`)
- **Success:** Green for confirmed actions

### Rules

- ❌ **NEVER** multiple primary actions on same page
- ❌ **NEVER** destructive actions without confirmation dialog
- ✅ Primary action always rightmost

---

## Colour and type

Colour comes from the theme's tokens, never a palette name: a state is `StatusMark`, a warning strip
is `bg-[var(--semantic-warning-soft)]` with a `border-[var(--semantic-warning)]` edge, text that
means "danger" or "success" is `text-[var(--semantic-danger-readable)]` or `...success-readable`,
and an icon with no meaning is `text-[var(--color-muted-foreground)]`. A raw hue (`text-red-500`,
`from-violet-500/20`) does not change with the theme or the country; `dark:` is not needed because
the tokens already do, and `@custom-variant dark` in `app/globals.css` follows the app's own theme
should one ever be.

Type below the headings is five named sizes, defined as `@utility` in `app/globals.css`:
`text-label` (12px), `text-badge` (10px), `text-caption` (11px),
`text-meta` (13px) and `text-reading` (15px). An arbitrary `text-[Npx]` is
refused. `lib/utils/utils.ts` teaches `cn()` that they are sizes, so a later text colour does not
drop them. `tests/colour-and-type-contract.test.ts` names the file and line.

## Cross-Domain Navigation

- ✅ Open a related record in its detail overlay (`?detail=<type>:<id>`,
  `components/shared/entity-detail-route-client.tsx`) rather than navigating away from the page
- ✅ Create a related entity in a dialog (`useFormDialog`, above)
- ❌ Never navigate away from a form without save/cancel

---

## Mobile Responsive Patterns

### Breakpoints

- **Mobile:** <768px (base styles)
- **Tablet:** 768px-1024px (`md:`)
- **Desktop:** >1024px (`lg:`)

### Required Behaviors

| Component | Mobile      | Tablet     | Desktop   |
| --------- | ----------- | ---------- | --------- |
| Sidebar   | Hidden      | Icons only | Expanded  |
| Tables    | Cards       | Scroll     | Full      |
| Forms     | 1 column    | 1 column   | 2 columns |
| Dialogs   | Full-screen | 80% width  | Max 600px |

### Mobile-First CSS

```tsx
// ✅ Correct: Mobile-first
<div className="flex flex-col md:flex-row">

// ❌ Wrong: Desktop-first
<div className="flex flex-row md:flex-col">
```

---

## PR Checklist

Before submitting any UI PR:

- [ ] **Sidebar Limit:** No new top-level item without removal
- [ ] **Navigation Depth:** Does not exceed 3 levels
- [ ] **Page Type:** Matches one of 5 canonical types
- [ ] **Form Pattern:** Uses `useFormDialog`, or a sheet form for several records
- [ ] **Context Preservation:** Implements `returnTo` for cross-section links
- [ ] **Mobile Responsive:** Includes `md:` and `lg:` breakpoints
- [ ] **Empty State:** Defined with helpful message + action
- [ ] **Loading State:** Shows skeleton or spinner
- [ ] **Error Handling:** Toast for global, inline for field errors
- [ ] **Confirmation:** Destructive actions require dialog

---

## Anti-Patterns

### ❌ DON'T

```tsx
// Custom form state
const [formData, setFormData] = useState({});
const [errors, setErrors] = useState({});
// ...manual validation
```

### ✅ DO

```tsx
// Use provided hooks
const dialog = useFormDialog({ schema, onSubmit });
```

---

### ❌ DON'T

```tsx
// Delete without confirmation
onClick={() => deleteProperty(id)}
```

### ✅ DO

```tsx
// Confirm destructive actions
<AlertDialog>
  <AlertDialogTrigger>Delete</AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogAction onClick={() => deleteProperty(id)}>Confirm Delete</AlertDialogAction>
  </AlertDialogContent>
</AlertDialog>
```

---

### ❌ DON'T

```tsx
// Desktop-only table
<table className="w-full">
```

### ✅ DO

```tsx
// Responsive with mobile fallback
<div className="hidden md:block">
  <Table />
</div>
<div className="md:hidden">
  <MobileCards />
</div>
```

---

## Questions?

Contact the UX team before implementing:

- New page layouts
- New navigation items
- New form patterns
- Mobile-specific features

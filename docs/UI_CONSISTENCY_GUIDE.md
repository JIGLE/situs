# UI Consistency Guide

This document defines the **non-negotiable rules** for all UI development in Situs. Engineers must pass this checklist before any UI PR is merged.

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
- **Wizard:** >15 fields OR multiple entity relationships

**Required:**

- ✅ Zod schema validation
- ✅ Inline field errors
- ✅ Loading state on submit
- ✅ Cancel button that returns to origin

### 5. Wizard Page

**Purpose:** Multi-step complex data entry

**Required:**

- ✅ Step indicator (1 of N)
- ✅ Back/Next buttons
- ✅ Draft persistence (24h TTL)
- ✅ "Resume Draft" banner

**Rules:**

- ❌ Max 6 steps
- ❌ Max 10 fields per step

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

Actions go in `children`. One heading per screen: a tab's view does not repeat the page title
(`CLAUDE.md`, screen density).

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

### Multi-Step Wizard (Complex Forms)

```tsx
import { useMultiStepForm } from "@/lib/hooks/use-multi-step-form";

const wizard = useMultiStepForm<FormData>({
  steps: stepConfig,
  schema: zodSchema,
  onComplete: async (data) => {
    /* save */
  },
  persistence: { key: "draft-key", ttl: 24 * 60 * 60 * 1000 },
});
```

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
- [ ] **Form Pattern:** Uses `useFormDialog` or `useMultiStepForm`
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

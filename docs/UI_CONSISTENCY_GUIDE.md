# UI Consistency Guide

This document defines the **non-negotiable rules** for all UI development in Situs. Engineers must pass this checklist before any UI PR is merged.

---

## Information Architecture

> **Status (2026-07-09, roadmap 3.3):** this flat "Assets/People/Finance" grouping was
> **not adopted**. Three IA proposals existed; only one was built. The canonical IA is the
> Operations / Intelligence (Reports) / System grouping, and the authority for it is now the
> code — `lib/portal/access.ts`, where the routes and their redirects live — rather than any
> document. The two audits this note previously cited have been deleted as point-in-time
> records. Kept here for history; do not use this structure as a reference for new nav work.

### Top-Level Navigation (7 Items Max) — superseded, see status note above

```
Home         → Dashboard overview
Assets       → Properties, Units, Owners, Map
People       → Tenants, Leases
Maintenance  → Tickets, Work orders
Correspondence → Templates, Messages
Finance      → Income, Expenses, Payment Matrix
Insights     → Analytics, Reports
Settings     → User preferences, Integrations
```

**Rules:**

- ❌ **NEVER** add a new top-level sidebar item without removing/merging another
- ❌ **NEVER** create a sidebar item for a feature with <3 sub-pages
- ✅ New features must fit into existing sections

### Navigation Depth

| Section        | Max Depth | Example                    |
| -------------- | --------- | -------------------------- |
| Home           | 1         | Home                       |
| Assets         | 3         | Assets → Property → Unit   |
| People         | 3         | People → Tenant → Lease    |
| Maintenance    | 2         | Maintenance → Ticket       |
| Correspondence | 2         | Correspondence → Template  |
| Finance        | 3         | Finance → Income → Receipt |
| Insights       | 2         | Insights → Report          |
| Settings       | 2         | Settings → Category        |

**Rules:**

- ❌ **NEVER** exceed 3 levels of navigation depth
- ✅ If deeper access needed, use modals/drawers instead of new pages

---

## Page Types

### 1. Dashboard Page

**Purpose:** High-level overview with actionable insights

**Required Sections:**

- Header: Title + date range selector (if applicable)
- KPI Row: 3-6 metric cards with trends
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
import { PageHeader } from "@/components/ui/page-header";

<PageHeader
  title="Assets"
  description="Manage your property portfolio"
  breadcrumbs={[{ label: "Assets" }]}
  primaryAction={{
    label: "Add Property",
    icon: <Plus className="h-4 w-4" />,
    onClick: handleAdd,
  }}
  secondaryActions={[{ label: "Export", onClick: handleExport }]}
/>;
```

### Empty State

```tsx
import { EmptyState } from "@/components/ui/page-header";

<EmptyState
  icon={<Building2 className="h-12 w-12" />}
  title="No properties yet"
  description="Get started by adding your first property"
  action={{ label: "Add Property", onClick: handleAdd }}
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

### Context Preservation

When navigating between sections, use `returnTo` parameter:

```tsx
// Navigating from Property to Tenant
router.push(`/people/${tenantId}?returnTo=/assets/${propertyId}`);

// Back button reads returnTo
const handleBack = () => {
  const returnTo = searchParams.get("returnTo");
  router.push(returnTo || "/assets");
};
```

### Inline Entity Creation

When creating related entities, use dialogs to prevent context loss:

```tsx
import { useInlineCreate, InlineCreateTrigger } from "@/lib/hooks/use-inline-create";

// In your parent form component
const inlineCreateTenant = useInlineCreate<TenantFormData, Tenant>({
  schema: tenantSchema,
  initialData: { name: "", email: "" },
  onSubmit: async (data) => {
    const tenant = await createTenant(data);
    return tenant;
  },
  onCreated: (tenant) => {
    // Auto-select the newly created tenant
    setSelectedTenantId(tenant.id);
  },
  dialogTitle: "Create New Tenant",
  renderForm: ({ formData, formErrors, updateFormData }) => (
    <TenantFormFields data={formData} errors={formErrors} onChange={updateFormData} />
  ),
});

// In the Select component
<Select value={selectedTenantId}>
  <SelectContent>
    {tenants.map((t) => (
      <SelectItem key={t.id} value={t.id}>
        {t.name}
      </SelectItem>
    ))}
    <InlineCreateTrigger label="Create New Tenant" onClick={inlineCreateTenant.open} />
  </SelectContent>
</Select>;

{
  /* Render the dialog */
}
{
  inlineCreateTenant.dialog;
}
```

**Rules:**

- ✅ Max 2 levels of inline creation
- ❌ Never navigate away from form without save/cancel

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

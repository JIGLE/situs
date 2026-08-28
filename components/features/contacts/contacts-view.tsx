"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Plus, Search, Star, Phone, Mail, Building2, Tag, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/utils/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SegmentedFilter } from "@/components/ui/segmented-filter";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { formatCurrency as formatCurrencyUtil, type Currency } from "@/lib/utils/currency";
import { EmptyStateIllustration } from "@/components/ui/empty-state-illustrations";

interface MaintenanceContact {
  id: string;
  name: string;
  company: string | null;
  type: "contractor" | "vendor" | "internal";
  specialties: string[];
  email: string | null;
  phone: string | null;
  hourlyRate: number | null;
  currency: string;
  rating: number | null;
  notes: string | null;
}

/**
 * The API speaks Prisma's enum; this view speaks lowercase.
 *
 * `MaintenanceContactType` is `CONTRACTOR | VENDOR | INTERNAL_STAFF`, and every comparison in this
 * file is against `"contractor" | "vendor" | "internal"`. Nothing caught the mismatch because the
 * fetch cast the raw value straight into the union — `c.type as MaintenanceContact["type"]` asserts
 * a shape rather than producing one, so TypeScript was told the answer instead of checking it.
 *
 * The damage was not cosmetic. Every type filter returned an empty list (three contractors existed
 * and "Empreiteiros" showed none), the summary line read "0 contractors · 0 vendors · 0 internal"
 * above four populated cards, and each card's type badge rendered as an empty pill because
 * `typeLabels["CONTRACTOR"]` is `undefined`.
 *
 * Normalising here, at the boundary, fixes all three at once. A new enum member must be added to
 * this map — the fallback keeps an unrecognised value out of the wrong bucket rather than filing it
 * as a contractor, which is what hid this in the first place.
 */
export function normalizeContactType(raw: unknown): MaintenanceContact["type"] {
  switch (String(raw ?? "").toUpperCase()) {
    case "VENDOR":
      return "vendor";
    case "INTERNAL_STAFF":
    case "INTERNAL":
      return "internal";
    default:
      return "contractor";
  }
}

const typeLabelKeys: Record<MaintenanceContact["type"], "contractor" | "vendor" | "internalStaff"> =
  {
    contractor: "contractor",
    vendor: "vendor",
    internal: "internalStaff",
  };

const typeColors: Record<string, string> = {
  contractor: "bg-[var(--color-info-muted)] text-[var(--color-info)] border-[var(--color-info)]/20",
  vendor: "bg-purple-500/10 text-purple-600 border-purple-500/20",
  internal:
    "bg-[var(--color-success-muted)] text-[var(--color-success)] border-[var(--color-success)]/20",
};

export function ContactsView(): React.ReactElement {
  const t = useTranslations("contacts");
  const [contacts, setContacts] = useState<MaintenanceContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("all");

  const fetchContacts = useCallback(async () => {
    try {
      setLoading(true);
      const json = await apiFetch<Record<string, unknown>[]>("/api/contacts");
      // Transform API response to match component interface
      const rawItems = Array.isArray(json) ? json : [];
      const data = rawItems.map((c): MaintenanceContact => ({
        id: String(c.id),
        name: String(c.contactPerson || c.name || "Unknown"),
        company: c.company ? String(c.company) : null,
        type: normalizeContactType(c.type),
        specialties:
          typeof c.specialties === "string"
            ? JSON.parse(c.specialties)
            : (c.specialties as string[]) || [],
        email: c.email ? String(c.email) : null,
        phone: c.phone ? String(c.phone) : null,
        hourlyRate: c.hourlyRate != null ? Number(c.hourlyRate) : null,
        currency: String(c.currency || "EUR"),
        rating: c.rating != null ? Number(c.rating) : null,
        notes: c.notes ? String(c.notes) : null,
      }));
      setContacts(data);
    } catch (err) {
      console.error("Failed to fetch contacts:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  const filteredContacts = contacts.filter((contact) => {
    const matchesSearch =
      contact.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      contact.company?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      contact.specialties.some((s) => s.toLowerCase().includes(searchQuery.toLowerCase()));

    if (activeTab === "all") return matchesSearch;
    return matchesSearch && contact.type === activeTab;
  });

  const stats = {
    total: contacts.length,
    contractors: contacts.filter((c) => c.type === "contractor").length,
    vendors: contacts.filter((c) => c.type === "vendor").length,
    internal: contacts.filter((c) => c.type === "internal").length,
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* One utility row: counts as text (declutter rule 4), search, type
          filter, and the add action — no separate heading, no card grid. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">{t("summary", stats)}</p>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          {t("addVendor")}
        </Button>
      </div>

      {/* Filters and Search */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <SegmentedFilter
          value={activeTab}
          onValueChange={setActiveTab}
          options={[
            { value: "all", label: t("all") },
            { value: "contractor", label: t("contractors") },
            { value: "vendor", label: t("vendors") },
            { value: "internal", label: t("internal") },
          ]}
        />
      </div>

      {/* Contacts Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredContacts.length === 0 ? (
          <div className="col-span-full">
            <EmptyStateIllustration
              type="contacts"
              title={t("emptyTitle")}
              description={t("emptyDescription")}
            />
          </div>
        ) : (
          filteredContacts.map((contact) => (
            <Card key={contact.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                        {getInitials(contact.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <CardTitle className="text-base">{contact.name}</CardTitle>
                      {contact.company && (
                        <CardDescription className="flex items-center gap-1">
                          <Building2 className="h-3 w-3" />
                          {contact.company}
                        </CardDescription>
                      )}
                    </div>
                  </div>
                  <Badge variant="outline" className={typeColors[contact.type]}>
                    {t(`type.${typeLabelKeys[contact.type]}`)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Specialties */}
                <div className="flex flex-wrap gap-1">
                  {contact.specialties.map((specialty) => (
                    <Badge key={specialty} variant="secondary" className="text-xs">
                      <Tag className="h-3 w-3 mr-1" />
                      {specialty}
                    </Badge>
                  ))}
                </div>

                {/* Contact Info. Calling or emailing the contractor is what this card is for,
                    so these are the primary tap path, not links in prose — responsive rule 2's
                    exemption does not cover them. They measured 20px tall, under the 24px WCAG
                    2.2 floor, and were the only touch-target failures left anywhere in the app
                    (8 of them: four contacts x two links). The floor applies below `md` only,
                    so the desktop card keeps its current density. */}
                <div className="space-y-1.5 text-sm text-muted-foreground">
                  {contact.email && (
                    <div className="flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5 shrink-0" />
                      <a
                        href={`mailto:${contact.email}`}
                        className="inline-flex items-center break-all hover:text-foreground max-md:min-h-11"
                      >
                        {contact.email}
                      </a>
                    </div>
                  )}
                  {contact.phone && (
                    <div className="flex items-center gap-2">
                      <Phone className="h-3.5 w-3.5 shrink-0" />
                      <a
                        href={`tel:${contact.phone}`}
                        className="inline-flex items-center hover:text-foreground max-md:min-h-11"
                      >
                        {contact.phone}
                      </a>
                    </div>
                  )}
                </div>

                {/* Rate and Rating */}
                <div className="flex items-center justify-between pt-2 border-t">
                  {contact.hourlyRate ? (
                    <span className="text-sm font-medium">
                      {formatCurrencyUtil(contact.hourlyRate, {
                        currency: contact.currency as Currency,
                      })}
                      {t("perHour")}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                  {contact.rating && (
                    <div className="flex items-center gap-1">
                      <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                      <span className="text-sm font-medium">{contact.rating}</span>
                    </div>
                  )}
                </div>

                {/* Notes */}
                {contact.notes && (
                  <p className="text-xs text-muted-foreground italic">"{contact.notes}"</p>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

export default ContactsView;

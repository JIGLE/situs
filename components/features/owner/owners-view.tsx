"use client";

import { useState, useMemo, forwardRef, useImperativeHandle } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Download, Plus, Phone, Mail, MapPin, Building2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils/utils";
import { useCurrency } from "@/lib/contexts/currency-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LoadingState } from "@/components/ui/loading-state";
import { EmptyStateIllustration } from "@/components/ui/empty-state-illustrations";
import { SearchFilter } from "@/components/ui/search-filter";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useApp } from "@/lib/contexts/app-context";
import { Owner } from "@/lib/types";
import { ownerSchema, type OwnerFormData } from "@/lib/schemas/owner.schema";
import { useToast } from "@/lib/contexts/toast-context";
import { useFormDialog } from "@/lib/hooks/use-form-dialog";
import jsPDF from "jspdf";
import { useConfirmDialog } from "@/lib/hooks/use-confirm-dialog";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { withEntityDetail } from "@/lib/utils/entity-detail-url";
import { OwnerNifField } from "./owner-nif-field";

export type OwnersViewRef = {
  openDialog: () => void;
};

export const OwnersView = forwardRef<OwnersViewRef, { density?: "comfortable" | "compact" }>(
  function OwnersView(_props, ref): React.ReactElement {
    const { state, addOwner, updateOwner } = useApp();
    const { owners, properties, receipts, expenses, loading } = state;
    const { success, error } = useToast();
    const t = useTranslations("owners");
    const tActions = useTranslations("actions");
    const tForms = useTranslations("forms");
    const tStatus = useTranslations("status");
    const locale = useLocale();
    const { formatCurrency } = useCurrency();
    const confirmDialog = useConfirmDialog();
    const compact = true; // Always compact
    const [generatingPdf, setGeneratingPdf] = useState<string | null>(null);

    // Owner detail overlay — opened via the shared `?detail=owner:<id>` mechanism
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const openOwnerOverlay = (ownerId: string) => {
      router.push(withEntityDetail(pathname, searchParams.toString(), "owner", ownerId));
    };

    // Search and filter state
    const [searchQuery, setSearchQuery] = useState("");
    const [propertyFilter, setPropertyFilter] = useState<string>("all");
    const [statusFilter, setStatusFilter] = useState<string>("all");

    const initialFormData: OwnerFormData = {
      name: "",
      email: "",
      phone: "",
      address: "",
      notes: "",
      taxIdentificationNumber: "",
    };

    const dialog = useFormDialog<OwnerFormData, Owner>({
      schema: ownerSchema,
      initialData: initialFormData,
      onSubmit: async (data, isEdit) => {
        if (isEdit && dialog.editingItem) {
          await updateOwner(dialog.editingItem.id, data);
          success(t("toastUpdated"));
        } else {
          await addOwner(data);
          success(t("toastCreated"));
        }
      },
      onError: (errorMessage) => {
        error(errorMessage);
      },
      validation: { validateOnChange: true, debounceValidation: 300 },
    });

    // Expose dialog methods to parent via ref
    useImperativeHandle(ref, () => ({
      openDialog: dialog.openDialog,
    }));

    const generateStatement = async (owner: Owner) => {
      setGeneratingPdf(owner.id);
      try {
        const doc = new jsPDF();

        doc.setFontSize(20);
        doc.text(t("pdf.heading"), 105, 20, { align: "center" });

        doc.setFontSize(12);
        doc.text(`${t("pdf.owner")}: ${owner.name}`, 20, 40);
        doc.text(`${t("pdf.date")}: ${new Date().toLocaleDateString(locale)}`, 20, 50);

        doc.line(20, 60, 190, 60);

        doc.text(t("pdf.period"), 20, 70);
        doc.text(t("pdf.summary"), 20, 85);

        let yPos = 95;
        let totalNetIncome = 0;

        if (owner.properties && owner.properties.length > 0) {
          owner.properties.forEach((po) => {
            const propName = po.property?.name || t("pdf.unknownProperty");
            const percentage = po.ownershipPercentage / 100;

            // Filter financials for this property (current month example)
            // Extending for real usage, we should allow date selection.
            // For now, taking "All Time" or "Current Month" approach.
            // Let's do All Time for simplicity of this demo, or last 30 days.
            // Doing "All Time" effectively for now to ensure data shows up.

            const propIncome = receipts
              .filter((r) => r.propertyId === po.propertyId)
              .reduce((sum, r) => sum + r.amount, 0);

            const propExpenses = expenses
              .filter((e) => e.propertyId === po.propertyId)
              .reduce((sum, e) => sum + e.amount, 0);

            const ownerIncome = propIncome * percentage;
            const ownerExpenses = propExpenses * percentage;
            const net = ownerIncome - ownerExpenses;
            totalNetIncome += net;

            doc.text(`- ${propName} (${po.ownershipPercentage}%)`, 25, yPos);
            yPos += 7;
            doc.setFontSize(10);
            doc.text(`  ${t("pdf.shareOfIncome")}: ${formatCurrency(ownerIncome)}`, 30, yPos);
            doc.text(`  ${t("pdf.shareOfExpenses")}: ${formatCurrency(ownerExpenses)}`, 30, yPos);
            doc.text(`  ${t("pdf.net")}: ${formatCurrency(net)}`, 30, yPos);
            yPos += 10;
            doc.setFontSize(12);
          });
        } else {
          doc.text(t("pdf.none"), 25, yPos);
          yPos += 10;
        }

        yPos += 10;
        doc.line(20, yPos, 190, yPos);
        yPos += 10;
        doc.setFontSize(14);
        doc.text(`${t("pdf.totalNet")}: ${formatCurrency(totalNetIncome)}`, 20, yPos);

        doc.save(
          `statement-${owner.name.replace(/\s+/g, "-")}-${new Date().toISOString().split("T")[0]}.pdf`,
        );
        success(t("toastStatement"));
      } catch (err) {
        console.error("Error generating PDF:", err);
        error(t("toastStatementFailed"));
      } finally {
        setGeneratingPdf(null);
      }
    };

    // Filter owners based on search and filters
    const filteredOwners = useMemo(() => {
      return owners.filter((owner) => {
        // Search filter
        const matchesSearch =
          searchQuery === "" ||
          owner.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          owner.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (owner.phone && owner.phone.toLowerCase().includes(searchQuery.toLowerCase()));

        // Property filter
        const matchesProperty =
          propertyFilter === "all" ||
          (owner.properties && owner.properties.some((p) => p.propertyId === propertyFilter));

        // Status filter (active/inactive based on whether they have properties)
        const isActive = owner.properties && owner.properties.length > 0;
        const matchesStatus =
          statusFilter === "all" ||
          (statusFilter === "active" && isActive) ||
          (statusFilter === "inactive" && !isActive);

        return matchesSearch && matchesProperty && matchesStatus;
      });
    }, [owners, searchQuery, propertyFilter, statusFilter]);

    return (
      <>
        {loading ? (
          <LoadingState variant="cards" count={6} />
        ) : (
          <div className="space-y-6">
            <Dialog open={dialog.isOpen} onOpenChange={(open) => !open && dialog.closeDialog()}>
              <DialogTrigger asChild>
                <Button onClick={dialog.openDialog} className="hidden">
                  <Plus className="w-4 h-4" />
                  {t("addOwner")}
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-[var(--color-card)] border-[var(--color-border)] max-w-lg">
                <DialogHeader>
                  <DialogTitle className="text-[var(--color-foreground)]">
                    {dialog.editingItem ? t("editTitle") : t("createTitle")}
                  </DialogTitle>
                  <DialogDescription>
                    {dialog.editingItem ? t("editDescription") : t("createDescription")}
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={dialog.handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">{tForms("fullName")}</Label>
                    <Input
                      id="name"
                      value={dialog.formData.name}
                      onChange={(e) => dialog.updateFormData({ name: e.target.value })}
                      className={dialog.formErrors.name ? "border-red-500" : ""}
                      placeholder={t("namePlaceholder")}
                    />
                    {dialog.formErrors.name && (
                      <p className="text-sm text-red-500">{dialog.formErrors.name}</p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="email">{tForms("email")}</Label>
                      <Input
                        id="email"
                        type="email"
                        value={dialog.formData.email}
                        onChange={(e) => dialog.updateFormData({ email: e.target.value })}
                        className={dialog.formErrors.email ? "border-red-500" : ""}
                        placeholder={t("emailPlaceholder")}
                      />
                      {dialog.formErrors.email && (
                        <p className="text-sm text-red-500">{dialog.formErrors.email}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="phone">{tForms("phone")}</Label>
                      <Input
                        id="phone"
                        value={dialog.formData.phone}
                        onChange={(e) => dialog.updateFormData({ phone: e.target.value })}
                        className={dialog.formErrors.phone ? "border-red-500" : ""}
                        placeholder={t("phonePlaceholder")}
                      />
                      {dialog.formErrors.phone && (
                        <p className="text-sm text-red-500">{dialog.formErrors.phone}</p>
                      )}
                    </div>
                  </div>

                  <OwnerNifField
                    id="taxIdentificationNumber"
                    value={dialog.formData.taxIdentificationNumber ?? ""}
                    onChange={(value) => dialog.updateFormData({ taxIdentificationNumber: value })}
                  />

                  <div className="space-y-2">
                    <Label htmlFor="address">{tForms("address")}</Label>
                    <Input
                      id="address"
                      value={dialog.formData.address}
                      onChange={(e) => dialog.updateFormData({ address: e.target.value })}
                      className={dialog.formErrors.address ? "border-red-500" : ""}
                      placeholder={t("addressPlaceholder")}
                    />
                    {dialog.formErrors.address && (
                      <p className="text-sm text-red-500">{dialog.formErrors.address}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="notes">{tForms("notes")}</Label>
                    <Textarea
                      id="notes"
                      value={dialog.formData.notes}
                      onChange={(e) => dialog.updateFormData({ notes: e.target.value })}
                      className={dialog.formErrors.notes ? "border-red-500" : ""}
                      placeholder={t("notesPlaceholder")}
                      rows={3}
                    />
                    {dialog.formErrors.notes && (
                      <p className="text-sm text-red-500">{dialog.formErrors.notes}</p>
                    )}
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={dialog.closeDialog}>
                      {tActions("cancel")}
                    </Button>
                    <Button type="submit" disabled={dialog.isSubmitting}>
                      {dialog.isSubmitting
                        ? tForms("saving")
                        : dialog.editingItem
                          ? t("submitUpdate")
                          : t("submitCreate")}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>

            {/* Search and Filter */}
            <SearchFilter
              searchPlaceholder="Search owners by name, email, or phone..."
              onSearchChange={setSearchQuery}
              onFilterChange={(key, value) => {
                if (key === "property") setPropertyFilter(value);
                if (key === "status") setStatusFilter(value);
              }}
              filters={[
                {
                  key: "property",
                  label: tForms("property"),
                  options: [
                    { label: tForms("allProperties"), value: "all" },
                    ...properties.map((property) => ({
                      label: property.name,
                      value: property.id,
                    })),
                  ],
                  defaultValue: "all",
                },
                {
                  key: "status",
                  label: tForms("status"),
                  options: [
                    { label: tStatus("all"), value: "all" },
                    { label: tStatus("active"), value: "active" },
                    { label: tStatus("inactive"), value: "inactive" },
                  ],
                  defaultValue: "all",
                },
              ]}
            />

            <div
              className={cn(
                "grid",
                compact
                  ? "gap-1 grid-cols-2 md:grid-cols-4 lg:grid-cols-6"
                  : "gap-4 md:grid-cols-2 lg:grid-cols-3",
              )}
            >
              {filteredOwners.length === 0 ? (
                <div className="col-span-full">
                  <EmptyStateIllustration
                    type={owners.length === 0 ? "owners" : "generic"}
                    title={owners.length === 0 ? undefined : "No owners found"}
                    description={
                      owners.length === 0 ? undefined : "Try adjusting your search or filters"
                    }
                    onAction={owners.length === 0 ? dialog.openDialog : undefined}
                    compact={compact}
                  />
                </div>
              ) : (
                filteredOwners.map((owner) => (
                  <Card
                    key={owner.id}
                    className="bg-[var(--color-card)] border-[var(--color-border)] cursor-pointer hover:border-[var(--color-accent-primary)]/40 hover:shadow-lg transition-all duration-200"
                    onClick={() => openOwnerOverlay(owner.id)}
                  >
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle
                        className={cn(
                          compact ? "text-xs font-bold" : "text-xl font-bold",
                          "text-[var(--color-foreground)]",
                        )}
                      >
                        {owner.name}
                      </CardTitle>
                      {/* Edit/Delete removed from card; use Owner detail modal for CRUD */}
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3 mt-2">
                        <div className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
                          <Mail className="w-4 h-4" />
                          <span>{owner.email}</span>
                        </div>
                        {owner.phone && (
                          <div className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
                            <Phone className="w-4 h-4" />
                            <span>{owner.phone}</span>
                          </div>
                        )}
                        {owner.address && (
                          <div className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
                            <MapPin className="w-4 h-4" />
                            <span>{owner.address}</span>
                          </div>
                        )}

                        <div className="pt-2 border-t border-[var(--color-border)] min-h-[60px]">
                          <div className="flex items-center gap-2 text-sm font-medium text-[var(--color-muted-foreground)] mb-1">
                            <Building2 className="w-4 h-4" />
                            <span>{t("propertiesOwned")}</span>
                          </div>
                          {owner.properties && owner.properties.length > 0 ? (
                            <ul className="text-xs text-[var(--color-muted-foreground)] space-y-1">
                              {owner.properties.map((p) => (
                                <li key={p.id}>
                                  {p.property?.name ?? t("property")} &mdash;{" "}
                                  {p.ownershipPercentage}%
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="text-xs text-[var(--color-muted-foreground)] italic">
                              {t("noProperties")}
                            </p>
                          )}
                        </div>

                        {/* Revenue share summary */}
                        {owner.properties &&
                          owner.properties.length > 0 &&
                          (() => {
                            const ownerIncome = owner.properties.reduce((sum, po) => {
                              const propIncome = receipts
                                .filter(
                                  (r) => r.propertyId === po.propertyId && r.status === "paid",
                                )
                                .reduce((s, r) => s + r.amount, 0);
                              return sum + propIncome * (po.ownershipPercentage / 100);
                            }, 0);
                            const ownerExpenses = owner.properties.reduce((sum, po) => {
                              const propExp = expenses
                                .filter((e) => e.propertyId === po.propertyId)
                                .reduce((s, e) => s + e.amount, 0);
                              return sum + propExp * (po.ownershipPercentage / 100);
                            }, 0);
                            const net = ownerIncome - ownerExpenses;
                            return (
                              <div className="pt-2 border-t border-[var(--color-border)] grid grid-cols-2 gap-2 text-xs">
                                <div>
                                  <p className="text-[var(--color-muted-foreground)]">
                                    {t("incomeShare")}
                                  </p>
                                  <p className="font-semibold text-green-400">
                                    {formatCurrency(ownerIncome)}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[var(--color-muted-foreground)]">
                                    {t("netShare")}
                                  </p>
                                  <p
                                    className={cn(
                                      "font-semibold",
                                      net >= 0 ? "text-green-400" : "text-red-400",
                                    )}
                                  >
                                    {formatCurrency(net)}
                                  </p>
                                </div>
                              </div>
                            );
                          })()}

                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full mt-2"
                          onClick={(e) => {
                            e.stopPropagation();
                            generateStatement(owner);
                          }}
                          disabled={generatingPdf === owner.id}
                        >
                          <Download className="w-4 h-4 mr-2" />
                          {generatingPdf === owner.id ? "Generating..." : "Owner Statement"}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>
        )}

        <ConfirmationDialog dialog={confirmDialog} />
      </>
    );
  },
);

OwnersView.displayName = "OwnersView";

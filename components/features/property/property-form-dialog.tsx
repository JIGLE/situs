"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/utils";
import { useApp } from "@/lib/contexts/app-context";
import { useCurrency } from "@/lib/contexts/currency-context";
import { useFormDialog } from "@/lib/hooks/use-form-dialog";
import { propertySchema, type PropertyFormData } from "@/lib/schemas/property.schema";
import { getCountryName, resolveCountryCode } from "@/lib/utils/country";
import {
  AddressVerificationService,
  type AddressSuggestion,
} from "@/lib/utils/address-verification";
import type { Property } from "@/lib/types";

const initialFormData: PropertyFormData = {
  name: "",
  address: "",
  streetAddress: "",
  city: "",
  zipCode: "",
  country: "PT",
  latitude: undefined,
  longitude: undefined,
  addressVerified: false,
  buildingId: undefined,
  buildingName: "",
  type: "apartment",
  bedrooms: 1,
  bathrooms: 1,
  rent: 0,
  status: "vacant",
  description: "",
};

export type PropertyFormDialogRef = {
  /** Opens the create form. `prefill` seeds fields (e.g. a building being added to). */
  openDialog: (prefill?: Partial<PropertyFormData>) => void;
  openEditDialog: (property: Property) => void;
};

/**
 * The single create/edit form for Property. Shared by the Portfolio list
 * (PropertiesView) and the property detail header's Edit action so both stay
 * on the exact same schema/onSubmit path instead of drifting into two forms.
 * Each mounting site owns its own instance (its own useFormDialog state) —
 * only the form itself is shared, matching how only one can be open at a
 * time per screen.
 */
export const PropertyFormDialog = forwardRef<PropertyFormDialogRef>(
  function PropertyFormDialog(_props, ref) {
    const { addProperty, updateProperty } = useApp();
    const { currencySymbol } = useCurrency();
    const t = useTranslations("properties");
    const tForms = useTranslations("forms");
    const tActions = useTranslations("actions");
    const tStatus = useTranslations("status");
    const tMaint = useTranslations("maintenance");

    // Form UI state — collapsible sections
    const [showManualFields, setShowManualFields] = useState(false);
    const [showDetails, setShowDetails] = useState(false);

    // Address verification state
    const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);

    const dialog = useFormDialog<PropertyFormData, Property>({
      schema: propertySchema,
      initialData: initialFormData,
      onSubmit: async (data, isEdit) => {
        if (isEdit && dialog.editingItem) {
          await updateProperty(dialog.editingItem.id, data);
        } else {
          await addProperty(data);
        }
      },
      successMessage: {
        create: "Property added successfully!",
        update: "Property updated successfully!",
      },
      validation: { validateOnChange: true, debounceValidation: 300 },
    });

    useImperativeHandle(ref, () => ({
      openDialog: (prefill) => {
        dialog.openDialog();
        if (prefill) dialog.updateFormData(prefill);
      },
      openEditDialog: (property) => dialog.openEditDialog(property),
    }));

    // Reset collapsible sections when dialog closes
    useEffect(() => {
      if (!dialog.isOpen) {
        setShowManualFields(false);
        setShowDetails(false);
      }
      // On edit, auto-expand details if the property already has them filled
      if (dialog.isOpen && dialog.editingItem) {
        const item = dialog.editingItem;
        if (item.bedrooms > 1 || item.bathrooms > 1 || item.description) {
          setShowDetails(true);
        }
      }
    }, [dialog.isOpen, dialog.editingItem]);

    const handleAddressSearch = async (query: string) => {
      if (query.length < 3) {
        setAddressSuggestions([]);
        setShowSuggestions(false);
        return;
      }

      try {
        const suggestions = await AddressVerificationService.searchAddresses(
          query,
          getCountryName(dialog.formData.country as "PT" | "ES") as "Portugal" | "Spain",
        );
        setAddressSuggestions(suggestions);
        setShowSuggestions(suggestions.length > 0);
      } catch (error) {
        console.error("Address search failed:", error);
        setAddressSuggestions([]);
        setShowSuggestions(false);
      }
    };

    const handleAddressSelect = (suggestion: AddressSuggestion) => {
      const verifiedAddress = AddressVerificationService.parseAddressSuggestion(suggestion);

      dialog.updateFormData({
        address: suggestion.display_name,
        streetAddress: verifiedAddress.streetAddress,
        city: verifiedAddress.city,
        zipCode: verifiedAddress.zipCode,
        country: resolveCountryCode(verifiedAddress.country) as "PT" | "ES",
        latitude: verifiedAddress.latitude,
        longitude: verifiedAddress.longitude,
        addressVerified: verifiedAddress.verified,
        buildingId: undefined,
        buildingName: verifiedAddress.streetAddress,
      });

      setShowManualFields(false);
      setAddressSuggestions([]);
      setShowSuggestions(false);
    };

    return (
      <Dialog open={dialog.isOpen} onOpenChange={(open) => !open && dialog.closeDialog()}>
        <DialogContent className="bg-[var(--color-card-solid)] border-[var(--color-border)] max-w-2xl max-h-[90vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
            <DialogTitle className="text-[var(--color-foreground)]">
              {dialog.editingItem ? "Edit Property" : "Add New Property"}
            </DialogTitle>
            <DialogDescription>
              {dialog.editingItem ? "Update property details" : "Enter property information"}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={dialog.handleSubmit} className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">{t("fields.name")}</Label>
                  <Input
                    id="name"
                    placeholder={t("namePlaceholder")}
                    value={dialog.formData.name}
                    onChange={(e) => dialog.updateFormData({ name: e.target.value })}
                    className={dialog.formErrors.name ? "border-[var(--color-destructive)]" : ""}
                  />
                  {dialog.formErrors.name && (
                    <p className="text-sm text-destructive">{dialog.formErrors.name}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="type">{t("fields.type")}</Label>
                  <Select
                    value={dialog.formData.type}
                    onValueChange={(value: PropertyFormData["type"]) =>
                      dialog.updateFormData({ type: value })
                    }
                  >
                    <SelectTrigger
                      className={dialog.formErrors.type ? "border-[var(--color-destructive)]" : ""}
                    >
                      <SelectValue placeholder={t("fields.selectType")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="apartment">{t("types.apartment")}</SelectItem>
                      <SelectItem value="house">{t("types.house")}</SelectItem>
                      <SelectItem value="condo">{t("types.condo")}</SelectItem>
                      <SelectItem value="townhouse">{t("types.townhouse")}</SelectItem>
                      <SelectItem value="commercial">{t("types.commercial")}</SelectItem>
                      <SelectItem value="other">{t("types.other")}</SelectItem>
                    </SelectContent>
                  </Select>
                  {dialog.formErrors.type && (
                    <p className="text-sm text-destructive">{dialog.formErrors.type}</p>
                  )}
                </div>
              </div>

              {/* Address Section */}
              <div className="space-y-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="address">Address *</Label>
                    {dialog.formData.addressVerified && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[var(--color-success)] flex items-center gap-1">
                          ✓ Verified
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowManualFields((v) => !v)}
                          className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] underline underline-offset-2 min-h-[32px] px-1"
                        >
                          {showManualFields ? "Hide fields" : "Edit manually"}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      id="address"
                      placeholder={t("addressPlaceholder")}
                      value={dialog.formData.address}
                      onFocus={(e) =>
                        e.target.scrollIntoView({ behavior: "smooth", block: "center" })
                      }
                      onChange={(e) => {
                        dialog.updateFormData({ address: e.target.value });
                        handleAddressSearch(e.target.value);
                      }}
                      className={
                        dialog.formErrors.address ? "border-[var(--color-destructive)]" : ""
                      }
                    />
                    {showSuggestions && addressSuggestions.length > 0 && (
                      <div className="absolute z-10 w-full bg-[var(--color-popover)] border border-[var(--color-border)] rounded-md mt-1 max-h-60 overflow-y-auto">
                        {addressSuggestions.map((suggestion, _index) => (
                          <button
                            key={suggestion.place_id}
                            type="button"
                            className="w-full text-left px-3 py-2 hover:bg-[var(--color-surface-hover)] first:rounded-t-md last:rounded-b-md"
                            onClick={() => handleAddressSelect(suggestion)}
                          >
                            <div className="text-sm text-[var(--color-foreground)]">
                              {suggestion.display_name}
                            </div>
                            <div className="text-xs text-[var(--color-muted-foreground)]">
                              {suggestion.address.postcode && `${suggestion.address.postcode}, `}
                              {suggestion.address.city || suggestion.address.municipality}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {dialog.formErrors.address && (
                    <p className="text-sm text-destructive">{dialog.formErrors.address}</p>
                  )}
                </div>

                {/* Sub-fields: shown when not verified (user typed manually) or toggled open */}
                {(showManualFields ||
                  (!dialog.formData.addressVerified && dialog.formData.address.length > 0)) && (
                  <div className="space-y-3 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="country">{tForms("country")}</Label>
                        <Select
                          value={dialog.formData.country}
                          onValueChange={(value) =>
                            dialog.updateFormData({
                              country: value as "PT" | "ES",
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="PT">{t("country.portugal")}</SelectItem>
                            <SelectItem value="ES">{t("country.spain")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="zipCode">{t("postalCode")}</Label>
                        <Input
                          id="zipCode"
                          placeholder={dialog.formData.country === "PT" ? "1234-567" : "12345"}
                          value={dialog.formData.zipCode || ""}
                          onChange={(e) => dialog.updateFormData({ zipCode: e.target.value })}
                          className={
                            dialog.formErrors.zipCode ? "border-[var(--color-destructive)]" : ""
                          }
                        />
                        {dialog.formErrors.zipCode && (
                          <p className="text-sm text-destructive">{dialog.formErrors.zipCode}</p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="city">{tForms("city")}</Label>
                        <Input
                          id="city"
                          value={dialog.formData.city || ""}
                          onChange={(e) => dialog.updateFormData({ city: e.target.value })}
                          className={
                            dialog.formErrors.city ? "border-[var(--color-destructive)]" : ""
                          }
                        />
                        {dialog.formErrors.city && (
                          <p className="text-sm text-destructive">{dialog.formErrors.city}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="streetAddress">{t("streetAddress")}</Label>
                        <Input
                          id="streetAddress"
                          value={dialog.formData.streetAddress || ""}
                          onChange={(e) =>
                            dialog.updateFormData({
                              streetAddress: e.target.value,
                            })
                          }
                          className={
                            dialog.formErrors.streetAddress
                              ? "border-[var(--color-destructive)]"
                              : ""
                          }
                        />
                        {dialog.formErrors.streetAddress && (
                          <p className="text-sm text-destructive">
                            {dialog.formErrors.streetAddress}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {dialog.formData.buildingId && (
                  <div className="space-y-2">
                    <Label htmlFor="buildingName">{t("buildingName")}</Label>
                    <Input
                      id="buildingName"
                      placeholder={t("buildingPlaceholder")}
                      value={dialog.formData.buildingName || ""}
                      onChange={(e) =>
                        dialog.updateFormData({
                          buildingName: e.target.value,
                        })
                      }
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="rent">Monthly Rent ({currencySymbol})</Label>
                  <Input
                    id="rent"
                    type="number"
                    min="0"
                    placeholder="0"
                    value={dialog.formData.rent || ""}
                    onChange={(e) =>
                      dialog.updateFormData({
                        rent: parseFloat(e.target.value) || 0,
                      })
                    }
                    className={dialog.formErrors.rent ? "border-[var(--color-destructive)]" : ""}
                  />
                  {dialog.formErrors.rent && (
                    <p className="text-sm text-destructive">{dialog.formErrors.rent}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="status">{tForms("status")}</Label>
                  <Select
                    value={dialog.formData.status}
                    onValueChange={(value: PropertyFormData["status"]) =>
                      dialog.updateFormData({ status: value })
                    }
                  >
                    <SelectTrigger
                      className={
                        dialog.formErrors.status ? "border-[var(--color-destructive)]" : ""
                      }
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="vacant">{tStatus("vacant")}</SelectItem>
                      <SelectItem value="occupied">
                        {dialog.editingItem ? "Occupied" : "Occupied — I'll add the tenant next"}
                      </SelectItem>
                      {dialog.editingItem && (
                        <SelectItem value="maintenance">{tMaint("title")}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  {dialog.formErrors.status && (
                    <p className="text-sm text-destructive">{dialog.formErrors.status}</p>
                  )}
                </div>
              </div>

              {/* Optional details toggle */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowDetails((v) => !v)}
                  className="flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors min-h-[36px]"
                >
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform duration-150",
                      showDetails && "rotate-180",
                    )}
                  />
                  {showDetails ? "Hide details" : "Add details (bedrooms, bathrooms, description)"}
                </button>

                {showDetails && (
                  <div className="mt-3 space-y-3 rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="bedrooms">{t("fields.bedrooms")}</Label>
                        <Input
                          id="bedrooms"
                          type="number"
                          min="0"
                          max="20"
                          value={dialog.formData.bedrooms}
                          onChange={(e) =>
                            dialog.updateFormData({
                              bedrooms: parseInt(e.target.value) || 0,
                            })
                          }
                          className={
                            dialog.formErrors.bedrooms ? "border-[var(--color-destructive)]" : ""
                          }
                        />
                        {dialog.formErrors.bedrooms && (
                          <p className="text-sm text-destructive">{dialog.formErrors.bedrooms}</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="bathrooms">{t("fields.bathrooms")}</Label>
                        <Input
                          id="bathrooms"
                          type="number"
                          min="0"
                          max="20"
                          step="0.5"
                          value={dialog.formData.bathrooms}
                          onChange={(e) =>
                            dialog.updateFormData({
                              bathrooms: parseFloat(e.target.value) || 0,
                            })
                          }
                          className={
                            dialog.formErrors.bathrooms ? "border-[var(--color-destructive)]" : ""
                          }
                        />
                        {dialog.formErrors.bathrooms && (
                          <p className="text-sm text-destructive">{dialog.formErrors.bathrooms}</p>
                        )}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="description">{tForms("description")}</Label>
                      <Textarea
                        id="description"
                        value={dialog.formData.description}
                        onChange={(e) => dialog.updateFormData({ description: e.target.value })}
                        rows={3}
                        className={
                          dialog.formErrors.description ? "border-[var(--color-destructive)]" : ""
                        }
                      />
                      {dialog.formErrors.description && (
                        <p className="text-sm text-destructive">{dialog.formErrors.description}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
            {/* end scrollable fields */}
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 border-t border-[var(--color-border)] px-6 py-4 shrink-0">
              <Button
                type="button"
                variant="outline"
                onClick={dialog.closeDialog}
                disabled={dialog.isSubmitting}
                className="w-full sm:w-auto"
              >
                {tActions("cancel")}
              </Button>
              <Button type="submit" loading={dialog.isSubmitting} className="w-full sm:w-auto">
                {dialog.editingItem ? "Update Property" : "Create Property"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    );
  },
);

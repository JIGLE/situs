"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { ZodError } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import {
  AddressVerificationService,
  type AddressSuggestion,
} from "@/lib/utils/address-verification";
import type { Property } from "@/lib/types";
import { useCsrf } from "@/lib/contexts/csrf-context";
import {
  composeAddress,
  lookupAddress,
  reverseLookup,
  suggestionPrecision,
  type ReverseAddress,
} from "./address-lookup";
import { LocationStatus, type LookupState } from "./location-status";

/** The building Select's value for none: a Select item cannot be empty. */
const NO_BUILDING = "none";

// Leaflet reads `window` as it loads.
const LocationPicker = dynamic(() => import("./location-picker"), { ssr: false });

/** The address fields; a change to any of them asks the map again. */
type AddressFields = Pick<PropertyFormData, "address" | "streetAddress" | "city" | "zipCode">;

/** How long typing has to pause before the map is asked, and before suggestions are. */
const LOOKUP_DELAY_MS = 1200;
const SUGGEST_DELAY_MS = 400;

const initialFormData: PropertyFormData = {
  name: "",
  address: "",
  streetAddress: "",
  city: "",
  zipCode: "",
  latitude: undefined,
  longitude: undefined,
  addressVerified: false,
  buildingId: undefined,
  buildingName: "",
  locationPrecision: null,
  permilage: null,
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
  /** Opens the edit form; `map` opens it with the map shown, to put the property's pin. */
  openEditDialog: (property: Property, options?: { map?: boolean }) => void;
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
    const { addProperty, updateProperty, state } = useApp();
    const buildings = state?.buildings ?? [];
    const { token: csrfToken } = useCsrf();
    const { currencySymbol } = useCurrency();
    const t = useTranslations("properties");
    const tForms = useTranslations("forms");
    const tActions = useTranslations("actions");

    // Form UI state — collapsible sections
    const [showManualFields, setShowManualFields] = useState(false);
    const [showDetails, setShowDetails] = useState(false);

    // Address verification state
    const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);

    // Where the address is on the map: the lookup in flight or its last answer, the map shown or
    // not, and the address at a pin the owner put down.
    const [lookupState, setLookupState] = useState<LookupState>("idle");
    const [showMap, setShowMap] = useState(false);
    const [pinAddress, setPinAddress] = useState<ReverseAddress | null>(null);
    const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Only the latest lookup writes: an earlier one answering late must not move the pin back.
    const lookupSeq = useRef(0);
    // Whether this edit changed the address, so an unplaceable one is refused only then: an old
    // property is not held up over an address nobody touched.
    const addressTouched = useRef(false);

    const dialog = useFormDialog<PropertyFormData, Property>({
      schema: propertySchema,
      initialData: initialFormData,
      onSubmit: async (submitted, isEdit) => {
        const data = await placeBeforeSave(submitted);
        if (isEdit && dialog.editingItem) {
          await updateProperty(dialog.editingItem.id, data);
        } else {
          await addProperty(data);
        }
      },
      successMessage: {
        create: t("toastCreated"),
        update: t("toastUpdated"),
      },
      validation: { validateOnChange: true, debounceValidation: 300 },
    });

    useImperativeHandle(ref, () => ({
      openDialog: (prefill) => {
        dialog.openDialog();
        if (prefill) dialog.updateFormData(prefill);
      },
      openEditDialog: (property, options) => {
        dialog.openEditDialog(property);
        if (options?.map) setShowMap(true);
      },
    }));

    /**
     * The data to save, placed on the map first when it has an address and no place yet. An
     * address the owner typed or changed here that the map cannot find, or finds only its postal
     * code or town, is refused on the address field, with the map open to put the pin by hand.
     * The map out of reach refuses nothing: the Portfolio map places it later.
     */
    async function placeBeforeSave(data: PropertyFormData): Promise<PropertyFormData> {
      if (data.latitude != null && data.longitude != null) {
        if (addressTouched.current && data.locationPrecision === "area") refuse("approximateError");
        return data;
      }
      if (!data.address.trim()) return data;
      if (lookupTimer.current) clearTimeout(lookupTimer.current);
      const seq = ++lookupSeq.current;
      setLookupState("looking");
      const result = await lookupAddress(csrfToken, data);
      if (seq === lookupSeq.current) setLookupState(result.state);
      if (result.state === "found") {
        const place = {
          latitude: result.found.latitude,
          longitude: result.found.longitude,
          locationPrecision: result.found.precision,
        };
        dialog.updateFormData(place);
        if (addressTouched.current && result.found.precision === "area") refuse("approximateError");
        return { ...data, ...place };
      }
      if (result.state === "notFound" && addressTouched.current) refuse("notFoundError");
      return data;
    }

    function refuse(key: "notFoundError" | "approximateError"): never {
      setShowMap(true);
      throw new ZodError([
        { code: "custom", path: ["address"], message: t(`location.${key}`), input: undefined },
      ]);
    }

    /** The map asked about the address as it now stands, once typing pauses. */
    function scheduleLookup(fields: AddressFields) {
      if (lookupTimer.current) clearTimeout(lookupTimer.current);
      if (fields.address.trim().length < 5) {
        setLookupState("idle");
        return;
      }
      lookupTimer.current = setTimeout(() => {
        const seq = ++lookupSeq.current;
        setLookupState("looking");
        void lookupAddress(csrfToken, fields).then((result) => {
          if (seq !== lookupSeq.current) return;
          setLookupState(result.state);
          if (result.state === "found") {
            dialog.updateFormData({
              latitude: result.found.latitude,
              longitude: result.found.longitude,
              locationPrecision: result.found.precision,
            });
          }
        });
      }, LOOKUP_DELAY_MS);
    }

    /**
     * A change the owner typed to the address. The place found from the old words is dropped, so
     * neither the pin nor a save keeps it; a pin the owner put down stays, since they are only
     * correcting how the address reads.
     */
    function changeAddress(patch: Partial<AddressFields>) {
      addressTouched.current = true;
      const pinned = dialog.formData.locationPrecision === "pinned";
      const next = { ...dialog.formData, ...patch };
      dialog.updateFormData({
        ...patch,
        ...(pinned
          ? {}
          : {
              latitude: undefined,
              longitude: undefined,
              locationPrecision: null,
              addressVerified: false,
            }),
      });
      if (!pinned) scheduleLookup(next);
    }

    /** The owner put the pin down: that is the place, and the address there is offered. */
    async function pickOnMap(latitude: number, longitude: number) {
      addressTouched.current = true;
      if (lookupTimer.current) clearTimeout(lookupTimer.current);
      lookupSeq.current++;
      setLookupState("idle");
      dialog.updateFormData({
        latitude,
        longitude,
        locationPrecision: "pinned",
        addressVerified: true,
      });
      const found = await reverseLookup(csrfToken, { latitude, longitude });
      setPinAddress(found);
      // Nothing typed yet: the address at the pin is the address.
      if (found && !dialog.formData.address.trim()) applyPinAddress(found);
    }

    function applyPinAddress(found: ReverseAddress) {
      dialog.updateFormData({
        address: composeAddress(found),
        streetAddress: found.streetAddress,
        zipCode: found.zipCode,
        city: found.city,
      });
      setPinAddress(null);
    }

    useEffect(
      () => () => {
        if (lookupTimer.current) clearTimeout(lookupTimer.current);
        if (suggestTimer.current) clearTimeout(suggestTimer.current);
      },
      [],
    );

    // Reset collapsible sections when dialog closes
    useEffect(() => {
      if (!dialog.isOpen) {
        setShowManualFields(false);
        setShowDetails(false);
        setShowMap(false);
        setPinAddress(null);
        setLookupState("idle");
        addressTouched.current = false;
        lookupSeq.current++;
        if (lookupTimer.current) clearTimeout(lookupTimer.current);
      }
      // On edit, auto-expand details if the property already has them filled
      if (dialog.isOpen && dialog.editingItem) {
        const item = dialog.editingItem;
        if ((item.bedrooms ?? 0) > 1 || (item.bathrooms ?? 0) > 1 || item.description) {
          setShowDetails(true);
        }
      }
    }, [dialog.isOpen, dialog.editingItem]);

    const handleAddressSearch = (query: string) => {
      if (suggestTimer.current) clearTimeout(suggestTimer.current);
      if (query.length < 3) {
        setAddressSuggestions([]);
        setShowSuggestions(false);
        return;
      }
      // Once typing pauses, not on every key: Nominatim asks for one request a second at most.
      suggestTimer.current = setTimeout(() => void searchSuggestions(query), SUGGEST_DELAY_MS);
    };

    const searchSuggestions = async (query: string) => {
      try {
        const suggestions = await AddressVerificationService.searchAddresses(query);
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
      addressTouched.current = true;
      if (lookupTimer.current) clearTimeout(lookupTimer.current);
      lookupSeq.current++;
      setLookupState("idle");
      setPinAddress(null);

      dialog.updateFormData({
        address: suggestion.display_name,
        streetAddress: verifiedAddress.streetAddress,
        city: verifiedAddress.city,
        zipCode: verifiedAddress.zipCode,
        latitude: verifiedAddress.latitude,
        longitude: verifiedAddress.longitude,
        addressVerified: verifiedAddress.verified,
        locationPrecision: suggestionPrecision(suggestion),
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
              {dialog.editingItem ? t("editProperty") : t("addNew")}
            </DialogTitle>
            <DialogDescription>
              {dialog.editingItem ? t("updateDetails") : t("enterInfo")}
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
                    <Label htmlFor="address">{tForms("address")} *</Label>
                    {dialog.formData.addressVerified && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[var(--color-success)] flex items-center gap-1">
                          ✓ {t("fields.verified")}
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowManualFields((v) => !v)}
                          className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] underline underline-offset-2 min-h-[32px] px-1"
                        >
                          {showManualFields ? t("hideFields") : t("editManually")}
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
                        changeAddress({ address: e.target.value });
                        handleAddressSearch(e.target.value);
                      }}
                      className={
                        dialog.formErrors.address ? "border-[var(--color-destructive)]" : ""
                      }
                    />
                    {showSuggestions && addressSuggestions.length > 0 && (
                      <div className="absolute z-10 w-full bg-[var(--color-popover)] border border-[var(--color-border)] mt-1 max-h-60 overflow-y-auto">
                        {addressSuggestions.map((suggestion, _index) => (
                          <button
                            key={suggestion.place_id}
                            type="button"
                            className="w-full text-left px-3 py-2 hover:bg-[var(--color-surface-hover)]"
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
                  <LocationStatus
                    lookup={lookupState}
                    precision={
                      dialog.formData.latitude != null && dialog.formData.longitude != null
                        ? (dialog.formData.locationPrecision ?? "street")
                        : null
                    }
                    hasAddress={dialog.formData.address.trim().length > 0}
                    mapOpen={showMap}
                    onToggleMap={() => setShowMap((open) => !open)}
                  />
                  {showMap && (
                    <div className="space-y-2">
                      <LocationPicker
                        latitude={dialog.formData.latitude}
                        longitude={dialog.formData.longitude}
                        onPick={(lat, lng) => void pickOnMap(lat, lng)}
                      />
                      <p className="text-xs text-[var(--color-muted-foreground)]">
                        {t("location.pinHint")}
                      </p>
                      {pinAddress && (
                        <div className="flex flex-col gap-2 border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                          <span className="min-w-0">
                            {t("location.atPin", { address: composeAddress(pinAddress) })}
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="shrink-0"
                            onClick={() => applyPinAddress(pinAddress)}
                          >
                            {t("location.useAddress")}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Sub-fields: shown when not verified (user typed manually) or toggled open */}
                {(showManualFields ||
                  (!dialog.formData.addressVerified && dialog.formData.address.length > 0)) && (
                  <div className="space-y-3 border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-3">
                    <div className="space-y-2">
                      <Label htmlFor="streetAddress">{t("streetAddress")}</Label>
                      <Input
                        id="streetAddress"
                        value={dialog.formData.streetAddress || ""}
                        onChange={(e) => changeAddress({ streetAddress: e.target.value })}
                        className={
                          dialog.formErrors.streetAddress ? "border-[var(--color-destructive)]" : ""
                        }
                      />
                      {dialog.formErrors.streetAddress && (
                        <p className="text-sm text-destructive">
                          {dialog.formErrors.streetAddress}
                        </p>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="zipCode">{t("postalCode")}</Label>
                        <Input
                          id="zipCode"
                          placeholder="1234-567"
                          value={dialog.formData.zipCode || ""}
                          onChange={(e) => changeAddress({ zipCode: e.target.value })}
                          className={
                            dialog.formErrors.zipCode ? "border-[var(--color-destructive)]" : ""
                          }
                        />
                        {dialog.formErrors.zipCode && (
                          <p className="text-sm text-destructive">{dialog.formErrors.zipCode}</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="city">{tForms("city")}</Label>
                        <Input
                          id="city"
                          value={dialog.formData.city || ""}
                          onChange={(e) => changeAddress({ city: e.target.value })}
                          className={
                            dialog.formErrors.city ? "border-[var(--color-destructive)]" : ""
                          }
                        />
                        {dialog.formErrors.city && (
                          <p className="text-sm text-destructive">{dialog.formErrors.city}</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* The building it is a fração of, and its permilagem there: what the building's
                    shared expenses are split by. Offered once there is a building to choose. */}
                {buildings.length > 0 && (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="buildingId">{t("building.label")}</Label>
                      <Select
                        value={dialog.formData.buildingId ?? NO_BUILDING}
                        onValueChange={(value) =>
                          dialog.updateFormData({
                            buildingId: value === NO_BUILDING ? null : value,
                          })
                        }
                      >
                        <SelectTrigger id="buildingId">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_BUILDING}>{t("building.none")}</SelectItem>
                          {buildings.map((building) => (
                            <SelectItem key={building.id} value={building.id}>
                              {building.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {dialog.formData.buildingId && (
                      <div className="space-y-2">
                        <Label htmlFor="permilage">{t("building.permilage")}</Label>
                        <Input
                          id="permilage"
                          type="number"
                          inputMode="decimal"
                          min="0"
                          max="1000"
                          step="0.01"
                          value={dialog.formData.permilage ?? ""}
                          onChange={(e) =>
                            dialog.updateFormData({
                              permilage: e.target.value === "" ? null : Number(e.target.value),
                            })
                          }
                          className={
                            dialog.formErrors.permilage ? "border-[var(--color-destructive)]" : ""
                          }
                        />
                        <p className="text-xs text-[var(--color-muted-foreground)]">
                          {t("building.permilageHint")}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Where Finanças places it. Importing a lease from its contract matches the property
                  on both. */}
              <div className="space-y-2">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="cadasterReference">{t("fields.cadasterReference")}</Label>
                    <Input
                      id="cadasterReference"
                      maxLength={50}
                      value={dialog.formData.cadasterReference ?? ""}
                      onChange={(e) => dialog.updateFormData({ cadasterReference: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="fraction">{t("fields.fraction")}</Label>
                    <Input
                      id="fraction"
                      maxLength={20}
                      value={dialog.formData.fraction ?? ""}
                      onChange={(e) => dialog.updateFormData({ fraction: e.target.value })}
                    />
                  </div>
                </div>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  {t("fields.cadasterHint")}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="rent">
                    {t("fields.monthlyRent")} ({currencySymbol})
                  </Label>
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
                  {/* Occupied or vacant is read from the leases (derived-state.ts); the one thing the
                      owner says here is whether the unit is out of use for maintenance, so it is a
                      switch rather than a choice between a status and "whatever the leases say". */}
                  <div className="flex min-h-11 items-center justify-between gap-3">
                    <Label htmlFor="status">{t("underMaintenance")}</Label>
                    <Switch
                      id="status"
                      checked={dialog.formData.status === "maintenance"}
                      onCheckedChange={(checked) =>
                        dialog.updateFormData({ status: checked ? "maintenance" : "vacant" })
                      }
                    />
                  </div>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    {t("maintenanceHint")}
                  </p>
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
                  {showDetails ? t("hideDetails") : t("addDetails")}
                </button>

                {showDetails && (
                  <div className="mt-3 space-y-3 border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="bedrooms">{t("fields.bedrooms")}</Label>
                        <Input
                          id="bedrooms"
                          type="number"
                          min="0"
                          max="20"
                          value={dialog.formData.bedrooms ?? ""}
                          onChange={(e) =>
                            dialog.updateFormData({
                              // Cleared is unknown, not 0: 0 reads as a studio.
                              bedrooms:
                                e.target.value === "" ? null : parseInt(e.target.value) || 0,
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
                          value={dialog.formData.bathrooms ?? ""}
                          onChange={(e) =>
                            dialog.updateFormData({
                              bathrooms:
                                e.target.value === "" ? null : parseFloat(e.target.value) || 0,
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
                {dialog.editingItem ? tActions("save") : tActions("create")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    );
  },
);

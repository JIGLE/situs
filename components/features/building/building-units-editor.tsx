"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { Building, Property } from "@/lib/types";
import { cn } from "@/lib/utils/utils";

export interface UnitChoice {
  propertyId: string;
  permilage: number | null;
}

interface BuildingUnitsEditorProps {
  building: Building;
  properties: Property[];
  buildings: Building[];
  saving: boolean;
  onSave: (units: UnitChoice[]) => void;
  onCancel: () => void;
}

/**
 * Which properties are this building's units, ticked from every property the owner has, and each
 * unit's permilagem beside it. One save sets them all: adding six frações is six ticks, not six
 * edits. A property in another building says which, and ticking it moves it here.
 */
export function BuildingUnitsEditor({
  building,
  properties,
  buildings,
  saving,
  onSave,
  onCancel,
}: BuildingUnitsEditorProps): React.ReactElement {
  const t = useTranslations("buildings.units");
  const tActions = useTranslations("actions");
  const buildingNames = useMemo(() => new Map(buildings.map((b) => [b.id, b.name])), [buildings]);
  // In this building first, then the rest by name.
  const ordered = useMemo(
    () =>
      [...properties].sort(
        (a, b) =>
          Number(b.buildingId === building.id) - Number(a.buildingId === building.id) ||
          a.name.localeCompare(b.name),
      ),
    [properties, building.id],
  );
  const [chosen, setChosen] = useState<Map<string, string>>(
    () =>
      new Map(
        properties
          .filter((p) => p.buildingId === building.id)
          .map((p) => [p.id, p.permilage != null ? String(p.permilage) : ""]),
      ),
  );

  const toggle = (id: string, on: boolean) =>
    setChosen((prev) => {
      const next = new Map(prev);
      if (on) next.set(id, properties.find((p) => p.id === id)?.permilage?.toString() ?? "");
      else next.delete(id);
      return next;
    });

  const parsed = [...chosen.entries()].map(([propertyId, raw]) => {
    const value = Number(raw.replace(",", "."));
    return { propertyId, raw, permilage: raw.trim() && value > 0 ? value : null };
  });
  const invalid = parsed.some((u) => u.raw.trim() !== "" && !(u.permilage && u.permilage <= 1000));
  const total = parsed.reduce((sum, u) => sum + (u.permilage ?? 0), 0);
  const allHave = parsed.length > 0 && parsed.every((u) => u.permilage != null);

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--color-muted-foreground)]">{t("hint")}</p>
      <ul className="divide-y divide-[var(--color-border)] border border-[var(--color-border)]">
        {ordered.map((property) => {
          const on = chosen.has(property.id);
          const elsewhere =
            property.buildingId && property.buildingId !== building.id
              ? buildingNames.get(property.buildingId)
              : undefined;
          return (
            <li key={property.id} className="flex items-center gap-3 px-3 py-2">
              <Checkbox
                checked={on}
                onCheckedChange={(value) => toggle(property.id, value)}
                aria-label={property.name}
                wrapperClassName="max-md:min-h-11 max-md:min-w-11 justify-center"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{property.name}</span>
                {elsewhere && (
                  <span className="block truncate text-xs text-[var(--color-muted-foreground)]">
                    {t("inOther", { building: elsewhere })}
                  </span>
                )}
              </span>
              {on && (
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={chosen.get(property.id) ?? ""}
                    onChange={(e) =>
                      setChosen((prev) => new Map(prev).set(property.id, e.target.value))
                    }
                    placeholder="—"
                    aria-label={t("permilageOf", { unit: property.name })}
                    className="h-9 w-20 text-right tabular-nums"
                  />
                  ‰
                </label>
              )}
            </li>
          );
        })}
      </ul>
      <p
        className={cn(
          "text-xs",
          invalid ? "text-[var(--color-destructive)]" : "text-[var(--color-muted-foreground)]",
        )}
      >
        {invalid
          ? t("invalid")
          : parsed.length === 0
            ? t("noneChosen")
            : allHave
              ? t("total", { total: Math.round(total * 100) / 100 })
              : t("equalFallback")}
      </p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          {tActions("cancel")}
        </Button>
        <Button
          type="button"
          loading={saving}
          disabled={invalid}
          onClick={() =>
            onSave(parsed.map(({ propertyId, permilage }) => ({ propertyId, permilage })))
          }
        >
          {t("save", { count: parsed.length })}
        </Button>
      </div>
    </div>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { useApp } from "@/lib/contexts/app-context";
import { EntityDetailOverlay } from "@/components/shared/entity-detail-overlay";
import { BuildingDetailView } from "./building-detail-view";

export function BuildingDetailOverlayClient({ id }: { id: string }) {
  const { state } = useApp();
  const t = useTranslations("entityOverlay");
  const building = state.buildings.find((b) => b.id === id);

  return (
    <EntityDetailOverlay
      title={t("building.title")}
      description={t("building.description", { name: building?.name ?? id })}
    >
      <BuildingDetailView buildingId={id} />
    </EntityDetailOverlay>
  );
}

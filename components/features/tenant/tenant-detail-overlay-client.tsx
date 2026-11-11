"use client";

import { useTranslations } from "next-intl";
import { useApp } from "@/lib/contexts/app-context";
import { EntityDetailOverlay } from "@/components/shared/entity-detail-overlay";
import { useEntityDetailClose } from "@/lib/hooks/use-entity-detail-close";
import { TenantDetailModal } from "./tenant-detail-modal";

export function TenantDetailOverlayClient({ id }: { id: string }) {
  const { state } = useApp();
  const t = useTranslations("entityOverlay");
  const tenant = state.tenants.find((tn) => tn.id === id);
  const handleClose = useEntityDetailClose();

  return (
    <EntityDetailOverlay
      title={t("tenant.title")}
      description={t("tenant.description", { name: tenant?.name ?? id })}
    >
      <TenantDetailModal tenantId={id} onClose={handleClose} />
    </EntityDetailOverlay>
  );
}

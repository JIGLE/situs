"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Edit2, Trash2, Home, X, Loader2 } from "lucide-react";
import { useApiError } from "@/lib/utils/api-error";
import { useCsrf } from "@/lib/contexts/csrf-context";
import { useToast } from "@/lib/contexts/toast-context";
import { apiFetch } from "@/lib/utils/api-client";
import { useConfirmDialog } from "@/lib/hooks/use-confirm-dialog";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";
import { EmptyStateIllustration } from "@/components/ui/empty-state-illustrations";

interface Unit {
  id: string;
  number: string;
  floor: number | null;
  sizeSqM: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  status: "vacant" | "occupied" | "maintenance" | "reserved";
  notes: string | null;
  property: {
    id: string;
    name: string;
    address: string;
  };
  leases: Array<{
    id: string;
    tenant: {
      id: string;
      name: string;
      email: string;
    };
  }>;
}

interface UnitsViewProps {
  propertyId?: string;
}

interface UnitFormData {
  number: string;
  floor: string;
  sizeSqM: string;
  bedrooms: string;
  bathrooms: string;
  status: "vacant" | "occupied" | "maintenance" | "reserved";
  notes: string;
  propertyId: string;
}

const initialFormData: UnitFormData = {
  number: "",
  floor: "",
  sizeSqM: "",
  bedrooms: "",
  bathrooms: "",
  status: "vacant",
  notes: "",
  propertyId: "",
};

export default function UnitsView({ propertyId }: UnitsViewProps) {
  const apiError = useApiError();
  const t = useTranslations("Units");
  const tActions = useTranslations("actions");
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [formData, setFormData] = useState<UnitFormData>(initialFormData);
  const [saving, setSaving] = useState(false);
  const { token: csrfToken } = useCsrf();
  const toast = useToast();
  const confirmDialog = useConfirmDialog();

  const fetchUnits = useCallback(async () => {
    try {
      const data = await apiFetch<Unit[]>("/api/units", csrfToken);
      setUnits(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Error fetching units:", error);
    } finally {
      setLoading(false);
    }
  }, [csrfToken]);

  useEffect(() => {
    fetchUnits();
  }, [fetchUnits]);

  const openAddModal = () => {
    setEditingUnit(null);
    setFormData({ ...initialFormData, propertyId: propertyId || "" });
    setShowAddModal(true);
  };

  const openEditModal = (unit: Unit) => {
    setEditingUnit(unit);
    setFormData({
      number: unit.number,
      floor: unit.floor?.toString() || "",
      sizeSqM: unit.sizeSqM?.toString() || "",
      bedrooms: unit.bedrooms?.toString() || "",
      bathrooms: unit.bathrooms?.toString() || "",
      status: unit.status,
      notes: unit.notes || "",
      propertyId: unit.property.id,
    });
    setShowAddModal(true);
  };

  const closeModal = () => {
    setShowAddModal(false);
    setEditingUnit(null);
    setFormData(initialFormData);
  };

  const handleSave = async () => {
    if (!formData.number.trim()) {
      toast.error(t("unitNumberRequired"));
      return;
    }
    if (!formData.propertyId && !propertyId) {
      toast.error(t("propertyRequired"));
      return;
    }

    setSaving(true);
    const payload = {
      number: formData.number.trim(),
      floor: formData.floor ? parseInt(formData.floor, 10) : null,
      sizeSqM: formData.sizeSqM ? parseFloat(formData.sizeSqM) : null,
      bedrooms: formData.bedrooms ? parseInt(formData.bedrooms, 10) : null,
      bathrooms: formData.bathrooms ? parseInt(formData.bathrooms, 10) : null,
      status: formData.status,
      notes: formData.notes || null,
      propertyId: formData.propertyId || propertyId,
    };

    try {
      const url = editingUnit ? `/api/units/${editingUnit.id}` : "/api/units";
      const method = editingUnit ? "PUT" : "POST";
      await apiFetch(url, csrfToken, method, payload);
      toast.success(editingUnit ? t("editUnit") : t("addUnit"));
      closeModal();
      await fetchUnits();
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (unitId: string) => {
    const previousUnits = units;
    setUnits(units.filter((u) => u.id !== unitId));
    try {
      await apiFetch(`/api/units/${unitId}`, csrfToken, "DELETE");
      toast.success(t("deleteUnit"));
    } catch (err) {
      setUnits(previousUnits);
      toast.error(apiError(err));
    }
  };

  // Filter units by property if propertyId is provided
  const filteredUnits = propertyId
    ? units.filter((unit) => unit.property.id === propertyId)
    : units;

  const getStatusColor = (status: string) => {
    switch (status) {
      case "vacant":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
      case "occupied":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
      case "maintenance":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
      case "reserved":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Add/Edit Unit Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {editingUnit ? t("editUnit") : t("addUnit")}
              </h2>
              <button
                onClick={closeModal}
                className="text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("unitNumber")} *
                </label>
                <input
                  type="text"
                  value={formData.number}
                  onChange={(e) => setFormData({ ...formData, number: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="e.g. 1A, 2B"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t("floor")}
                  </label>
                  <input
                    type="number"
                    value={formData.floor}
                    onChange={(e) => setFormData({ ...formData, floor: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t("size")}
                  </label>
                  <input
                    type="number"
                    value={formData.sizeSqM}
                    onChange={(e) => setFormData({ ...formData, sizeSqM: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t("bedrooms")}
                  </label>
                  <input
                    type="number"
                    value={formData.bedrooms}
                    onChange={(e) => setFormData({ ...formData, bedrooms: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t("bathrooms")}
                  </label>
                  <input
                    type="number"
                    value={formData.bathrooms}
                    onChange={(e) => setFormData({ ...formData, bathrooms: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("status")}
                </label>
                <select
                  value={formData.status}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      status: e.target.value as UnitFormData["status"],
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="vacant">{t("status_vacant")}</option>
                  <option value="occupied">{t("status_occupied")}</option>
                  <option value="maintenance">{t("status_maintenance")}</option>
                  <option value="reserved">{t("status_reserved")}</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("notes")}
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={closeModal}
                className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                {tActions("cancel")}
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingUnit ? tActions("save") : tActions("create")}
              </button>
            </div>
          </div>
        </div>
      )}

      {filteredUnits.length === 0 ? (
        <EmptyStateIllustration
          type="units"
          title={propertyId ? t("noUnitsInProperty") : t("noUnitsYet")}
          description={propertyId ? t("addFirstUnit") : t("startByAdding")}
          actionLabel={t("addUnit")}
          onAction={openAddModal}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredUnits.map((unit) => (
            <div
              key={unit.id}
              className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5 hover:shadow-lg transition-shadow"
            >
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-2">
                  <Home className="w-5 h-5 text-blue-600" />
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    {t("unit")} {unit.number}
                  </h3>
                </div>
                <span
                  className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(
                    unit.status,
                  )}`}
                >
                  {t(`status_${unit.status}`)}
                </span>
              </div>

              <div className="space-y-2 mb-4">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  <span className="font-medium">{t("property")}:</span> {unit.property.name}
                </p>
                {unit.floor !== null && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    <span className="font-medium">{t("floor")}:</span> {unit.floor}
                  </p>
                )}
                {unit.sizeSqM && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    <span className="font-medium">{t("size")}:</span> {unit.sizeSqM} m²
                  </p>
                )}
                {(unit.bedrooms || unit.bathrooms) && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {unit.bedrooms && `${unit.bedrooms} ${t("bedrooms")}`}
                    {unit.bedrooms && unit.bathrooms && " • "}
                    {unit.bathrooms && `${unit.bathrooms} ${t("bathrooms")}`}
                  </p>
                )}
                {unit.leases.length > 0 && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    <span className="font-medium">{t("tenant")}:</span> {unit.leases[0].tenant.name}
                  </p>
                )}
              </div>

              <div className="flex gap-2 pt-3 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => openEditModal(unit)}
                  className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  {tActions("edit")}
                </button>
                <button
                  onClick={() => {
                    confirmDialog.confirm(
                      {
                        title: t("deleteConfirmTitle"),
                        description: t("deleteConfirmDescription"),
                        confirmLabel: t("deleteUnit"),
                        variant: "destructive",
                      },
                      async () => {
                        handleDelete(unit.id);
                      },
                    );
                  }}
                  className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {t("deleteUnit")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <ConfirmationDialog dialog={confirmDialog} />
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Mail, Phone, MapPin, Building2, Edit, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useApp } from "@/lib/contexts/app-context";
import { useToast } from "@/lib/contexts/toast-context";
import { ownerSchema, type OwnerFormData } from "@/lib/schemas/owner.schema";
import { useConfirmDialog } from "@/lib/hooks/use-confirm-dialog";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";

interface OwnerDetailModalProps {
  ownerId: string;
  onClose: () => void;
}

export function OwnerDetailModal({ ownerId, onClose }: OwnerDetailModalProps) {
  const { state, updateOwner, deleteOwner } = useApp();
  const owner = state.owners.find((o) => o.id === ownerId) ?? null;
  const { success, error } = useToast();
  const t = useTranslations("owners");
  const tForms = useTranslations("forms");
  const tActions = useTranslations("actions");
  const confirmDialog = useConfirmDialog();
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<OwnerFormData>({
    name: "",
    email: "",
    phone: "",
    address: "",
    notes: "",
  });

  // Initialize form data when owner changes
  useEffect(() => {
    if (owner) {
      setFormData({
        name: owner.name,
        email: owner.email,
        phone: owner.phone || "",
        address: owner.address || "",
        notes: owner.notes || "",
      });
    }
  }, [owner]);

  if (!owner) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2">
        <p className="text-sm text-[var(--color-muted-foreground)]">{t("notFound")}</p>
      </div>
    );
  }

  const handleSave = async () => {
    try {
      const validated = ownerSchema.parse(formData);
      await updateOwner(owner.id, validated);
      success(t("toastUpdated"));
      setIsEditing(false);
    } catch (err) {
      if (err instanceof Error) {
        error(err.message);
      } else {
        error(t("toastUpdateFailed"));
      }
    }
  };

  const handleDelete = () => {
    confirmDialog.confirm(
      {
        title: t("deleteOwner"),
        description: t("deleteDescription"),
        confirmLabel: t("deleteOwner"),
        variant: "destructive",
      },
      async () => {
        await deleteOwner(owner.id);
        success(t("toastDeleted"));
        onClose();
      },
    );
  };

  const handleCancel = () => {
    setFormData({
      name: owner.name,
      email: owner.email,
      phone: owner.phone || "",
      address: owner.address || "",
      notes: owner.notes || "",
    });
    setIsEditing(false);
  };

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-col space-y-2 text-left">
          <div className="flex items-start justify-between">
            <div className="flex-1 flex items-start gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-primary/20 ring-1 ring-accent-primary/30">
                <span className="text-sm font-semibold text-accent-primary">
                  {owner.name
                    .split(" ")
                    .map((n: string) => n[0])
                    .join("")
                    .toUpperCase()}
                </span>
              </div>
              <div>
                <h2 className="text-2xl font-semibold leading-none tracking-tight text-[var(--color-foreground)]">
                  {isEditing ? "Edit Owner" : owner.name}
                </h2>
                <div className="flex flex-col gap-1 mt-1 text-sm text-[var(--color-muted-foreground)]">
                  <span className="flex items-center gap-1">
                    <Mail className="h-3 w-3" />
                    {owner.email}
                  </span>
                  {owner.phone && (
                    <span className="flex items-center gap-1">
                      <Phone className="h-3 w-3" />
                      {owner.phone}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {isEditing ? (
          // Edit Mode
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">{tForms("fullName")}</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="bg-[var(--color-surface)] border-[var(--color-border)]">
                <CardHeader>
                  <CardTitle className="text-sm text-[var(--color-muted-foreground)]">
                    {t("ownerInfo")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="space-y-2">
                    <Label htmlFor="email">{tForms("email")}</Label>
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">{tForms("phone")}</Label>
                    <Input
                      id="phone"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-[var(--color-surface)] border-[var(--color-border)]">
                <CardHeader>
                  <CardTitle className="text-sm text-[var(--color-muted-foreground)]">
                    {tForms("address")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="space-y-2">
                    <Label htmlFor="address">{tForms("address")}</Label>
                    <Input
                      id="address"
                      value={formData.address}
                      onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    />
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-2">
              <Card className="bg-[var(--color-surface)] border-[var(--color-border)]">
                <CardHeader>
                  <CardTitle className="text-sm text-[var(--color-muted-foreground)]">
                    {tForms("notes")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea
                    id="notes"
                    rows={3}
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  />
                </CardContent>
              </Card>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={handleCancel}>
                {tActions("cancel")}
              </Button>
              <Button onClick={handleSave}>{tActions("save")}</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {owner.address && (
              <Card className="bg-[var(--color-surface)] border-[var(--color-border)]">
                <CardHeader>
                  <CardTitle className="text-sm text-[var(--color-muted-foreground)]">
                    {tForms("address")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-start gap-2">
                    <MapPin className="h-4 w-4 text-[var(--color-muted-foreground)] mt-1" />
                    <div className="text-sm">
                      <p className="text-[var(--color-foreground)]">{owner.address}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Properties Owned */}
            {owner.properties && owner.properties.length > 0 && (
              <Card className="bg-[var(--color-surface)] border-[var(--color-border)]">
                <CardHeader>
                  <CardTitle className="text-sm text-[var(--color-muted-foreground)] flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    Properties Owned ({owner.properties.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {owner.properties.map((po) => (
                      <div
                        key={po.id}
                        className="flex items-center justify-between p-2 bg-[var(--color-card)] rounded"
                      >
                        <span className="text-sm text-[var(--color-foreground)]">
                          {po.property?.name || "Unknown Property"}
                        </span>
                        <span className="text-xs text-[var(--color-muted-foreground)]">
                          {po.ownershipPercentage}% ownership
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Notes */}
            {owner.notes && (
              <Card className="bg-[var(--color-surface)] border-[var(--color-border)]">
                <CardHeader>
                  <CardTitle className="text-sm text-[var(--color-muted-foreground)]">
                    {tForms("notes")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-[var(--color-foreground)]">{owner.notes}</p>
                </CardContent>
              </Card>
            )}

            {/* Action Buttons */}
            <div className="flex justify-between gap-2 pt-4 border-t border-[var(--color-border)]">
              <Button
                variant="destructive"
                onClick={handleDelete}
                className="flex items-center gap-1"
              >
                <Trash2 className="w-4 h-4" />
                {t("deleteOwner")}
              </Button>
              <Button onClick={() => setIsEditing(true)} className="flex items-center gap-1">
                <Edit className="w-4 h-4" />
                {t("editOwner")}
              </Button>
            </div>
          </div>
        )}
      </div>
      <ConfirmationDialog dialog={confirmDialog} />
    </>
  );
}

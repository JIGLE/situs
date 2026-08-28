"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/utils/api-client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Upload } from "lucide-react";
import type { DocumentRef, DocumentType } from "./document-types";
import { documentTypeConfig } from "./document-types";

interface Props {
  csrfToken: string | null;
  properties: DocumentRef[];
  tenants: DocumentRef[];
  owners: DocumentRef[];
  onSuccess: () => void;
}

const emptyForm = {
  name: "",
  description: "",
  type: "other" as DocumentType,
  propertyId: "",
  tenantId: "",
  ownerId: "",
  expiresAt: "",
  file: null as File | null,
};

export function DocumentUploadDialog({ csrfToken, properties, tenants, owners, onSuccess }: Props) {
  const t = useTranslations("documents");
  const tForms = useTranslations("forms");
  const tActions = useTranslations("actions");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [uploading, setUploading] = useState(false);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setForm((prev) => ({ ...prev, file, name: prev.name || file.name }));
    }
  };

  const handleUpload = async () => {
    if (!form.file || !form.name) return;
    setUploading(true);
    try {
      const reader = new FileReader();
      const fileContent = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(form.file!);
      });

      await apiFetch<Record<string, unknown>>("/api/documents", csrfToken, "POST", {
        name: form.name,
        description: form.description || undefined,
        type: form.type,
        mimeType: form.file.type,
        fileContent,
        propertyId: form.propertyId || undefined,
        tenantId: form.tenantId || undefined,
        ownerId: form.ownerId || undefined,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : undefined,
      });

      setOpen(false);
      setForm(emptyForm);
      onSuccess();
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Upload className="mr-2 h-4 w-4" />
          {t("upload")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("uploadTitle")}</DialogTitle>
          <DialogDescription>{t("uploadDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="file">{t("file")}</Label>
            <Input
              id="file"
              type="file"
              onChange={handleFileSelect}
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.txt"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="name">{tForms("fullName")}</Label>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder={t("namePlaceholder")}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="type">{tForms("type")}</Label>
            <Select
              value={form.type}
              onValueChange={(v) => setForm((prev) => ({ ...prev, type: v as DocumentType }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(documentTypeConfig).map(([key, config]) => (
                  <SelectItem key={key} value={key}>
                    {t(config.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="description">{t("descriptionPlaceholder")}</Label>
            <Textarea
              id="description"
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder={t("descriptionPlaceholder")}
              rows={2}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="expiresAt">{t("expiryOptional")}</Label>
            <Input
              id="expiresAt"
              type="date"
              value={form.expiresAt}
              onChange={(e) => setForm((prev) => ({ ...prev, expiresAt: e.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <Label>{t("linkTo")}</Label>
            <div className="grid grid-cols-3 gap-2">
              <Select
                value={form.propertyId}
                onValueChange={(v) => setForm((prev) => ({ ...prev, propertyId: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={tForms("property")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t("none")}</SelectItem>
                  {properties.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={form.tenantId}
                onValueChange={(v) => setForm((prev) => ({ ...prev, tenantId: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={tForms("tenant")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t("none")}</SelectItem>
                  {tenants.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={form.ownerId}
                onValueChange={(v) => setForm((prev) => ({ ...prev, ownerId: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("owner")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t("none")}</SelectItem>
                  {owners.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {tActions("cancel")}
          </Button>
          <Button onClick={handleUpload} disabled={uploading || !form.file || !form.name}>
            {uploading ? "Uploading..." : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FileText, Plus, Edit, Trash2, Send } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { EnhancedInput, EnhancedTextarea } from "@/components/ui/enhanced-input";
import { FormField, FormGrid, FormActions } from "@/components/ui/form-components";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LoadingState } from "@/components/ui/loading-state";
import { EmptyStateIllustration } from "@/components/ui/empty-state-illustrations";
import { useApp } from "@/lib/contexts/app-context";
import { CorrespondenceTemplate, Tenant } from "@/lib/types";
import { templateSchema, type TemplateFormData } from "@/lib/schemas/template.schema";
import { useToast } from "@/lib/contexts/toast-context";
import { useFormDialog } from "@/lib/hooks/use-form-dialog";
import jsPDF from "jspdf";
import { useConfirmDialog } from "@/lib/hooks/use-confirm-dialog";
import { ConfirmationDialog } from "@/components/shared/confirmation-dialog";

export type CorrespondenceViewProps = Record<string, never>;

/** The placeholders a template can carry. `labelKey` resolves against `correspondence.variable`
 *  — the `{{…}}` token itself is part of the stored template and never translated. */
const TEMPLATE_VARIABLES = [
  { key: "{{tenant_name}}", labelKey: "tenantName" },
  { key: "{{property_name}}", labelKey: "propertyName" },
  { key: "{{property_address}}", labelKey: "propertyAddress" },
  { key: "{{rent_amount}}", labelKey: "rentAmount" },
  { key: "{{due_date}}", labelKey: "dueDate" },
  { key: "{{lease_start}}", labelKey: "leaseStart" },
  { key: "{{lease_end}}", labelKey: "leaseEnd" },
] as const;

export function CorrespondenceView(): React.ReactElement {
  const { state, addTemplate, updateTemplate, deleteTemplate, addCorrespondence } = useApp();
  const { templates, correspondence: _correspondence, tenants, properties, loading } = state;
  const { success, error } = useToast();
  const confirmDialog = useConfirmDialog();
  const t = useTranslations("correspondence");
  const tActions = useTranslations("actions");
  const tForms = useTranslations("forms");
  const locale = useLocale();
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<CorrespondenceTemplate | null>(null);
  const [composeData, setComposeData] = useState({
    tenantId: "",
    subject: "",
    content: "",
  });

  const [isBatchOpen, setIsBatchOpen] = useState(false);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);
  const [generatingBatch, setGeneratingBatch] = useState(false);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  const insertVariable = (variable: string) => {
    const textarea = contentRef.current;
    const current = dialog.formData.content || "";
    if (!textarea) {
      dialog.updateFormData({ content: current + variable });
      return;
    }
    const start = textarea.selectionStart ?? current.length;
    const end = textarea.selectionEnd ?? current.length;
    const newValue = current.substring(0, start) + variable + current.substring(end);
    dialog.updateFormData({ content: newValue });
    requestAnimationFrame(() => {
      textarea.setSelectionRange(start + variable.length, start + variable.length);
      textarea.focus();
    });
  };

  const initialFormData: TemplateFormData = {
    name: "",
    type: "welcome",
    subject: "",
    content: "",
  };

  const dialog = useFormDialog<TemplateFormData, CorrespondenceTemplate>({
    schema: templateSchema,
    initialData: initialFormData,
    onSubmit: async (data, isEdit) => {
      const templateData = {
        ...data,
        variables: extractVariables(data.content),
      };

      if (isEdit && dialog.editingItem) {
        await updateTemplate(dialog.editingItem.id, templateData);
        success(t("toast.templateUpdated"));
      } else {
        await addTemplate(templateData);
        success(t("toast.templateCreated"));
      }
    },
    onError: (errorMessage) => {
      error(errorMessage);
    },
    validation: { validateOnChange: true, debounceValidation: 300 },
  });

  const handleCompose = (template: CorrespondenceTemplate) => {
    setSelectedTemplate(template);
    setComposeData({
      tenantId: "",
      subject: template.subject,
      content: template.content,
    });
    setIsComposeOpen(true);
  };

  const handleBatchClick = (template: CorrespondenceTemplate) => {
    setSelectedTemplate(template);
    setSelectedRecipientIds([]);
    setIsBatchOpen(true);
  };

  const toggleRecipient = (id: string) => {
    setSelectedRecipientIds((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id],
    );
  };

  const generateBatchPDF = async () => {
    if (!selectedTemplate) {
      error(t("toast.selectTemplate"));
      return;
    }
    if (selectedRecipientIds.length === 0) {
      error(t("toast.selectRecipient"));
      return;
    }

    setGeneratingBatch(true);
    try {
      const doc = new jsPDF();
      const recipients = tenants.filter((t) => selectedRecipientIds.includes(t.id));

      recipients.forEach((tenant, index) => {
        if (index > 0) doc.addPage();

        const content = replaceVariables(selectedTemplate.content || "", tenant);

        // Header
        doc.setFontSize(20);
        doc.text(selectedTemplate.subject || t("heading"), 105, 20, {
          align: "center",
        });

        // Content
        doc.setFontSize(12);
        const splitText = doc.splitTextToSize(content, 170);
        doc.text(splitText, 20, 40);

        // Footer
        doc.setFontSize(10);
        doc.text(`${t("heading")} · ${new Date().toLocaleDateString(locale)}`, 20, 280);
        doc.text(`${index + 1} / ${recipients.length}`, 180, 280);
      });

      const fileName = selectedTemplate.name
        ? selectedTemplate.name.replace(/\s+/g, "-")
        : "correspondence";
      doc.save(`batch-${fileName}.pdf`);
      success(t("toast.batchGenerated", { count: recipients.length }));
      setIsBatchOpen(false);
    } catch (err) {
      console.error("Batch generation error:", err);
      error(t("toast.batchFailed"));
    } finally {
      setGeneratingBatch(false);
    }
  };

  const handleSendCorrespondence = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedTemplate) return;

    const selectedTenant = tenants.find((t) => t.id === composeData.tenantId);
    if (!selectedTenant) {
      error(t("toast.selectOneTenant"));
      return;
    }

    try {
      // Replace variables in content
      const processedContent = replaceVariables(composeData.content, selectedTenant);

      const correspondenceData = {
        templateId: selectedTemplate.id,
        tenantId: selectedTenant.id,
        subject: composeData.subject,
        content: processedContent,
        status: "sent" as const,
        sentAt: new Date().toISOString(),
      };

      await addCorrespondence(correspondenceData);

      setIsComposeOpen(false);
      setSelectedTemplate(null);
      success(t("toast.sent"));
    } catch (err) {
      error(t("toast.sendFailed"));
      console.error("Correspondence send error:", err);
    }
  };

  const handleEdit = (template: CorrespondenceTemplate) => {
    dialog.openEditDialog(template, (t) => ({
      name: t.name,
      type: t.type,
      subject: t.subject,
      content: t.content,
    }));
  };

  const handleDelete = (id: string) => {
    confirmDialog.confirm(
      {
        title: t("deleteDialog.title"),
        description: t("deleteDialog.description"),
        confirmLabel: t("deleteDialog.confirmLabel"),
        variant: "destructive",
      },
      async () => {
        await deleteTemplate(id);
        success(t("toast.templateDeleted"));
      },
    );
  };

  const extractVariables = (content: string): string[] => {
    const variableRegex = /\{\{(\w+)\}\}/g;
    const matches = content.match(variableRegex);
    return matches ? [...new Set(matches.map((match) => match.slice(2, -2)))] : [];
  };

  const replaceVariables = (content: string, tenant: Tenant): string => {
    if (!content) return "";
    // These three used to substitute the literal words "Property address", "bedrooms" and
    // "bathrooms", marked "Would need property data" — so a letter written from a template
    // that used them reached the tenant reading "The flat has bedrooms bedrooms". The data
    // was already in `AppState`: the tenant carries `propertyId` and the property carries all
    // three fields. An unresolvable property leaves the placeholder standing rather than
    // substituting a word, because an obviously unfilled `{{bedrooms}}` is caught in the
    // preview, and a plausible wrong sentence is not.
    const property = tenant?.propertyId ? properties.find((p) => p.id === tenant.propertyId) : null;
    const orPlaceholder = (value: string | number | undefined, token: string) =>
      value === undefined || value === null || value === "" ? token : String(value);
    const formatDate = (value: string) => new Date(value).toLocaleDateString(locale);

    return content
      .replace(/\{\{tenant_name\}\}/g, orPlaceholder(tenant?.name, "{{tenant_name}}"))
      .replace(
        /\{\{property_name\}\}/g,
        orPlaceholder(tenant?.propertyName ?? property?.name, "{{property_name}}"),
      )
      .replace(/\{\{rent_amount\}\}/g, orPlaceholder(tenant?.rent, "{{rent_amount}}"))
      .replace(
        /\{\{lease_start\}\}/g,
        tenant?.leaseStart ? formatDate(tenant.leaseStart) : "{{lease_start}}",
      )
      .replace(
        /\{\{lease_end\}\}/g,
        tenant?.leaseEnd ? formatDate(tenant.leaseEnd) : "{{lease_end}}",
      )
      .replace(
        /\{\{property_address\}\}/g,
        orPlaceholder(property?.address, "{{property_address}}"),
      )
      .replace(/\{\{bedrooms\}\}/g, orPlaceholder(property?.bedrooms, "{{bedrooms}}"))
      .replace(/\{\{bathrooms\}\}/g, orPlaceholder(property?.bathrooms, "{{bathrooms}}"))
      .replace(/\{\{due_date\}\}/g, formatDate(new Date().toISOString()));
  };

  const getTypeBadge = (type: CorrespondenceTemplate["type"]) => {
    const colors = {
      welcome: "bg-[var(--color-success-muted)] text-[var(--color-success)]",
      rent_reminder: "bg-orange-600/20 text-orange-400",
      eviction_notice: "bg-[var(--color-error-muted)] text-[var(--color-error)]",
      maintenance_request: "bg-[var(--color-info-muted)] text-[var(--color-info)]",
      lease_renewal: "bg-purple-600/20 text-purple-400",
      custom: "bg-[var(--color-popover)] text-[var(--color-muted-foreground)]",
    };
    return (
      <Badge className={colors[type]}>
        {type.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase())}
      </Badge>
    );
  };

  return (
    <>
      {loading ? (
        <LoadingState variant="cards" count={6} />
      ) : (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-3xl font-bold tracking-tight text-[var(--color-foreground)]">
                {t("heading")}
              </h2>
              <p className="text-[var(--color-muted-foreground)]">{t("subtitle")}</p>
            </div>
            <Dialog open={dialog.isOpen} onOpenChange={(open) => !open && dialog.closeDialog()}>
              <DialogTrigger asChild>
                <Button onClick={dialog.openDialog} className="flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  {t("addTemplate")}
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-[var(--color-card)] border-[var(--color-border)] max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="text-[var(--color-foreground)]">
                    {dialog.editingItem ? t("editTemplate") : t("createTemplate")}
                  </DialogTitle>
                  <DialogDescription>{t("templateDialogDescription")}</DialogDescription>
                </DialogHeader>
                <form onSubmit={dialog.handleSubmit} className="space-y-6">
                  <FormGrid columns={2} gap="md">
                    <FormField
                      label={t("templateName")}
                      required
                      error={dialog.formErrors.name}
                      tooltip={t("templateNameTooltip")}
                    >
                      <EnhancedInput
                        id="name"
                        value={dialog.formData.name}
                        onChange={(e) => dialog.updateFormData({ name: e.target.value })}
                        placeholder={t("templateNamePlaceholder")}
                        required
                      />
                    </FormField>

                    <FormField
                      label={t("templateType")}
                      required
                      error={dialog.formErrors.type}
                      tooltip={t("templateTypeTooltip")}
                    >
                      <Select
                        value={dialog.formData.type}
                        onValueChange={(value: TemplateFormData["type"]) =>
                          dialog.updateFormData({ type: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={t("templateTypePlaceholder")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="welcome">{t("welcomeLetter")}</SelectItem>
                          <SelectItem value="rent_reminder">{t("types.rentReminder")}</SelectItem>
                          <SelectItem value="eviction_notice">
                            {t("types.evictionNotice")}
                          </SelectItem>
                          <SelectItem value="maintenance_request">
                            {t("types.maintenanceRequest")}
                          </SelectItem>
                          <SelectItem value="lease_renewal">{t("types.leaseRenewal")}</SelectItem>
                          <SelectItem value="custom">{t("types.custom")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormField>
                  </FormGrid>

                  <FormField
                    label={t("emailSubject")}
                    required
                    error={dialog.formErrors.subject}
                    tooltip={t("emailSubjectTooltip")}
                  >
                    <EnhancedInput
                      id="subject"
                      value={dialog.formData.subject}
                      onChange={(e) => dialog.updateFormData({ subject: e.target.value })}
                      placeholder={t("emailSubjectPlaceholder")}
                      maxLength={200}
                      showCharCount
                      required
                    />
                  </FormField>

                  <FormField
                    label={t("emailContent")}
                    required
                    error={dialog.formErrors.content}
                    tooltip={t("emailContentTooltip")}
                  >
                    <div className="space-y-2">
                      <div>
                        <p className="text-xs text-[var(--color-muted-foreground)] mb-1.5">
                          {t("insertPlaceholder")}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {TEMPLATE_VARIABLES.map(({ key, labelKey }) => (
                            <button
                              key={key}
                              type="button"
                              onClick={() => insertVariable(key)}
                              className="inline-flex items-center rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-xs text-[var(--color-muted-foreground)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-foreground)] transition-colors font-mono"
                            >
                              {t(`variable.${labelKey}`)}
                            </button>
                          ))}
                        </div>
                      </div>
                      <EnhancedTextarea
                        ref={contentRef}
                        id="content"
                        value={dialog.formData.content}
                        onChange={(e) => dialog.updateFormData({ content: e.target.value })}
                        rows={8}
                        placeholder={t("contentPlaceholder")}
                        maxLength={5000}
                        showCharCount
                        autoResize
                        required
                      />
                    </div>
                  </FormField>

                  <FormActions align="right">
                    <Button type="button" variant="outline" onClick={dialog.closeDialog}>
                      {tActions("cancel")}
                    </Button>
                    <Button type="submit" disabled={dialog.isSubmitting}>
                      {dialog.isSubmitting
                        ? tForms("saving")
                        : dialog.editingItem
                          ? t("editTemplate")
                          : t("createTemplate")}
                    </Button>
                  </FormActions>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid gap-4">
            {templates.length === 0 ? (
              <EmptyStateIllustration
                type="correspondence"
                title={t("emptyTitle")}
                description={t("emptyDescription")}
                onAction={dialog.openDialog}
                actionLabel={t("createTemplate")}
              />
            ) : (
              templates.map((template) => (
                <Card
                  key={template.id}
                  className="bg-[var(--color-card)] border-[var(--color-border)]"
                >
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-lg font-semibold text-[var(--color-foreground)]">
                            {template.name}
                          </h3>
                          {getTypeBadge(template.type)}
                        </div>
                        <p className="text-sm font-medium text-[var(--color-foreground)] mb-1">
                          {template.subject}
                        </p>
                        <p className="text-sm text-[var(--color-muted-foreground)] line-clamp-2 mb-2">
                          {template.content.length > 150
                            ? `${template.content.substring(0, 150)}...`
                            : template.content}
                        </p>
                        {template.variables.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {template.variables.map((variable: string) => (
                              <Badge key={variable} variant="outline" className="text-xs">
                                {variable}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleBatchClick(template)}
                          className="flex items-center gap-1"
                        >
                          <FileText className="w-3 h-3" />
                          {t("batchPdf")}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCompose(template)}
                          className="flex items-center gap-1"
                        >
                          <Send className="w-3 h-3" />
                          {t("send")}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEdit(template)}
                          className="flex items-center gap-1"
                        >
                          <Edit className="w-3 h-3" />
                          {tActions("edit")}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDelete(template.id)}
                          className="flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" />
                          {tActions("delete")}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          {/* Compose Dialog */}
          <Dialog open={isComposeOpen} onOpenChange={setIsComposeOpen}>
            <DialogContent className="bg-[var(--color-card)] border-[var(--color-border)] max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-[var(--color-foreground)]">
                  {t("sendTitle")}
                </DialogTitle>
                <DialogDescription>{t("sendDescription")}</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSendCorrespondence} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="tenant">{t("selectTenant")}</Label>
                  <Select
                    value={composeData.tenantId}
                    onValueChange={(value) => setComposeData({ ...composeData, tenantId: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("chooseTenant")} />
                    </SelectTrigger>
                    <SelectContent>
                      {tenants.map((tenant) => (
                        <SelectItem key={tenant.id} value={tenant.id}>
                          {tenant.name} - {tenant.propertyName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="compose-subject">{t("subject")}</Label>
                  <Input
                    id="compose-subject"
                    value={composeData.subject}
                    onChange={(e) =>
                      setComposeData({
                        ...composeData,
                        subject: e.target.value,
                      })
                    }
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="compose-content">{t("message")}</Label>
                  <Textarea
                    id="compose-content"
                    value={composeData.content}
                    onChange={(e) =>
                      setComposeData({
                        ...composeData,
                        content: e.target.value,
                      })
                    }
                    rows={10}
                    required
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsComposeOpen(false)}>
                    {tActions("cancel")}
                  </Button>
                  <Button type="submit" className="flex items-center gap-2">
                    <Send className="w-4 h-4" />
                    {t("sendMessage")}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>

          {/* Batch Dialog */}
          <Dialog open={isBatchOpen} onOpenChange={setIsBatchOpen}>
            <DialogContent className="bg-[var(--color-card)] border-[var(--color-border)] max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-[var(--color-foreground)]">
                  {t("batchTitle")}
                </DialogTitle>
                <DialogDescription>
                  {t("batchSubtitle", { name: selectedTemplate?.name ?? "" })}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="border border-[var(--color-border)] rounded-md p-4 max-h-[300px] overflow-y-auto">
                  <div className="flex items-center justify-between mb-2">
                    <Label>{t("selectRecipients")}</Label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedRecipientIds(tenants.map((t) => t.id))}
                    >
                      {t("selectAll")}
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {tenants.map((tenant) => (
                      <div
                        key={tenant.id}
                        className="flex items-center space-x-2 p-2 hover:bg-[var(--color-surface-hover)] rounded"
                      >
                        <input
                          type="checkbox"
                          id={`batch-${tenant.id}`}
                          checked={selectedRecipientIds.includes(tenant.id)}
                          onChange={() => toggleRecipient(tenant.id)}
                          className="rounded border-[var(--color-border)] bg-[var(--color-surface)] text-blue-600 focus:ring-blue-600"
                        />
                        <div className="flex-1">
                          <Label
                            htmlFor={`batch-${tenant.id}`}
                            className="cursor-pointer font-medium text-[var(--color-foreground)]"
                          >
                            {tenant.name}
                          </Label>
                          <p className="text-xs text-[var(--color-muted-foreground)]">
                            {tenant.propertyName}
                          </p>
                        </div>
                      </div>
                    ))}
                    {tenants.length === 0 && (
                      <p className="text-sm text-[var(--color-muted-foreground)] text-center">
                        {t("noTenants")}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsBatchOpen(false)}>
                    {tActions("cancel")}
                  </Button>
                  <Button onClick={generateBatchPDF} disabled={generatingBatch}>
                    {generatingBatch
                      ? t("generating")
                      : t("generateBatch", { count: selectedRecipientIds.length })}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}
      <ConfirmationDialog dialog={confirmDialog} />
    </>
  );
}

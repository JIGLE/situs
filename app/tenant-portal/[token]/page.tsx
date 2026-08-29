"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { TICKET_STATUS_KEY, type TicketStatus } from "@/lib/utils/maintenance-labels";
import { useApiError } from "@/lib/utils/api-error";
import { getCurrencyLocale, type Currency } from "@/lib/utils/currency";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/ui/card";
import { Button } from "@/ui/button";
import { Badge } from "@/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";
import { Separator } from "@/ui/separator";
import { Input } from "@/ui/input";
import { Textarea } from "@/ui/textarea";
import { Label } from "@/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import {
  Home,
  CreditCard,
  FileText,
  AlertCircle,
  CheckCircle2,
  Clock,
  Building2,
  Calendar,
  Loader2,
  Wrench,
  Plus,
  Download,
  Phone,
  X,
} from "lucide-react";

interface DocumentItem {
  id: string;
  name: string;
  description?: string;
  type: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
  expiresAt?: string;
}

interface TicketItem {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  category?: string;
  isTenantReport: boolean;
  createdAt: string;
  resolvedAt?: string;
}

interface TenantPortalData {
  tenant: {
    id: string;
    name: string;
    email: string;
    phone: string;
    leaseStart: string;
    leaseEnd: string;
    rent: number;
    paymentStatus: string;
    property?: {
      id: string;
      name: string;
      address: string;
      currency?: Currency;
    };
  };
  invoices: Array<{
    id: string;
    number: string;
    amount: number;
    dueDate: string;
    status: string;
    paidDate?: string;
  }>;
  recentPayments: Array<{
    id: string;
    amount: number;
    date: string;
    method: string;
    status: string;
    invoiceNumber?: string;
  }>;
  maintenanceRequests: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    createdAt: string;
    description?: string;
  }>;
}

interface TenantPortalPageProps {
  params: Promise<{ token: string }>;
}

/**
 * Ticket priority, mapped to the portal's own labels. The portal has `priorityLow` … `priorityUrgent`
 * of its own — this screen is written for a tenant rather than for the landlord, so it keeps its
 * wording — but it was rendering the stored enum instead, so a tenant saw "urgent" in English on
 * an otherwise translated page.
 */
const PORTAL_PRIORITY_KEY: Record<string, string> = {
  low: "priorityLow",
  medium: "priorityMedium",
  high: "priorityHigh",
  urgent: "priorityUrgent",
};

export default function TenantPortalPage({ params }: TenantPortalPageProps) {
  const router = useRouter();
  const t = useTranslations("tenantPortal.main");
  const tErrors = useTranslations("tenantPortal.errors");
  const apiError = useApiError();
  const tStatus = useTranslations("status");
  const tMaint = useTranslations("maintenance");
  // The document type keys live under `documents`, next to the owner-facing archive that
  // renders the same enum — one table of type names, not two that can disagree.
  const tDoc = useTranslations("documents");
  const locale = useLocale();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TenantPortalData | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [processingPayment, setProcessingPayment] = useState<string | null>(null);
  const [paymentMsg, setPaymentMsg] = useState<{ type: "success" | "error"; text: string } | null>(
    null,
  );

  // Maintenance state
  const [tickets, setTickets] = useState<TicketItem[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formPriority, setFormPriority] = useState<"low" | "medium" | "high" | "urgent">("medium");
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<{ type: "success" | "error"; text: string } | null>(
    null,
  );

  // Documents state
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsLoaded, setDocsLoaded] = useState(false);

  // Profile state
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneValue, setPhoneValue] = useState("");
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [phoneMsg, setPhoneMsg] = useState<{ type: "success" | "error"; text: string } | null>(
    null,
  );

  useEffect(() => {
    params.then((p) => setToken(p.token));
  }, [params]);

  useEffect(() => {
    if (!token) return;
    const fetchData = async () => {
      try {
        const response = await fetch(`/api/tenant-portal/${token}`);
        if (!response.ok) {
          setError(
            response.status === 401 || response.status === 404
              ? tErrors("invalidLink")
              : tErrors("loadFailed"),
          );
          return;
        }
        const result = await response.json();
        setData(result.data);
        setPhoneValue(result.data.tenant.phone ?? "");
      } catch {
        setError(tErrors("connectionFailed"));
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [token, tErrors]);

  const loadTickets = useCallback(async () => {
    if (!token) return;
    setTicketsLoading(true);
    try {
      const res = await fetch(`/api/tenant-portal/${token}/maintenance`);
      if (res.ok) {
        const result = await res.json();
        setTickets(result.data ?? []);
      }
    } finally {
      setTicketsLoading(false);
    }
  }, [token]);

  const loadDocuments = useCallback(async () => {
    if (!token || docsLoaded) return;
    setDocsLoading(true);
    try {
      const res = await fetch(`/api/tenant-portal/${token}/documents`);
      if (res.ok) {
        const result = await res.json();
        setDocuments(result.data ?? []);
      }
    } finally {
      setDocsLoading(false);
      setDocsLoaded(true);
    }
  }, [token, docsLoaded]);

  useEffect(() => {
    if (activeTab === "maintenance") loadTickets();
    if (activeTab === "documents") loadDocuments();
  }, [activeTab, loadTickets, loadDocuments]);

  const handleSubmitRequest = async () => {
    if (!token || !formTitle.trim() || !formDesc.trim()) return;
    setSubmitting(true);
    setSubmitMsg(null);
    try {
      const res = await fetch(`/api/tenant-portal/${token}/maintenance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: formTitle, description: formDesc, priority: formPriority }),
      });
      if (!res.ok) throw new Error();
      setSubmitMsg({ type: "success", text: t("requestSubmitted") });
      setFormTitle("");
      setFormDesc("");
      setFormPriority("medium");
      setShowCreateForm(false);
      loadTickets();
    } catch {
      setSubmitMsg({ type: "error", text: t("requestError") });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSavePhone = async () => {
    if (!token || !phoneValue.trim()) return;
    setPhoneSaving(true);
    setPhoneMsg(null);
    try {
      const res = await fetch(`/api/tenant-portal/${token}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneValue }),
      });
      if (!res.ok) throw new Error();
      setPhoneMsg({ type: "success", text: t("phoneSaved") });
      setEditingPhone(false);
      if (data) {
        setData({ ...data, tenant: { ...data.tenant, phone: phoneValue } });
      }
    } catch {
      setPhoneMsg({ type: "error", text: t("phoneError") });
    } finally {
      setPhoneSaving(false);
    }
  };

  const currency: Currency = data?.tenant.property?.currency ?? "EUR";
  const dateLocale = getCurrencyLocale(currency, locale);

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat(getCurrencyLocale(currency, locale), {
      style: "currency",
      currency,
    }).format(amount);

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString(dateLocale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case "paid":
      case "succeeded":
      case "resolved":
        return "bg-[var(--color-success-muted)] text-[var(--color-success)]";
      case "pending":
      case "processing":
      case "open":
        return "bg-[var(--color-warning-muted)] text-[var(--color-warning)]";
      case "overdue":
      case "failed":
        return "bg-[var(--color-error-muted)] text-[var(--color-destructive)]";
      case "in_progress":
        return "bg-[var(--color-info-muted)] text-[var(--color-info)]";
      default:
        return "bg-[var(--color-muted)] text-[var(--color-foreground)]";
    }
  };

  const handlePayInvoice = async (invoiceId: string, amount: number) => {
    if (!token || processingPayment) return;
    setProcessingPayment(invoiceId);
    setPaymentMsg(null);
    try {
      const response = await fetch(`/api/tenant-portal/${token}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId, amount, paymentMethodType: "card" }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || t("paymentFailed"));
      }
      const result = await response.json();
      if (result.data?.clientSecret) {
        setPaymentMsg({
          type: "success",
          text: t("paymentInitiated", { ref: result.data.paymentIntentId }),
        });
      }
      const dataResponse = await fetch(`/api/tenant-portal/${token}`);
      if (dataResponse.ok) {
        const refreshed = await dataResponse.json();
        setData(refreshed.data);
      }
    } catch (err) {
      setPaymentMsg({
        type: "error",
        // `t("paymentFailed")` was already the fallback; the server's English sentence was
        // preferred over it whenever there was one, which is the wrong way round on the one
        // screen a tenant sees.
        text: apiError(err),
      });
    } finally {
      setProcessingPayment(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)]">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-[var(--color-info)]" />
          <p className="mt-2 text-[var(--color-muted-foreground)]">{t("loading")}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)]">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[var(--color-destructive)]">
              <AlertCircle className="h-5 w-5" />
              {t("accessError")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[var(--color-muted-foreground)]">{error}</p>
          </CardContent>
          <CardFooter>
            <Button variant="outline" onClick={() => router.push("/")}>
              {t("returnHome")}
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const { tenant, invoices, recentPayments, maintenanceRequests } = data;
  const pendingInvoices = invoices.filter((i) => i.status === "pending" || i.status === "overdue");
  const upcomingPayment = pendingInvoices[0];
  const daysUntilDue = upcomingPayment
    ? Math.ceil((new Date(upcomingPayment.dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      {/* Header */}
      <header className="bg-[var(--color-card-solid)] border-b border-[var(--color-border)] sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Building2 className="h-6 w-6 text-[var(--color-info)]" />
              <div>
                <h1 className="text-lg font-semibold">
                  {tenant.property ? tenant.property.name : t("yourRentalHome")}
                </h1>
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  {t("tenantPortalFor", { name: tenant.name })}
                </p>
              </div>
            </div>
            {tenant.property && (
              <Badge variant="outline" className="hidden sm:flex">
                {tenant.property.name}
              </Badge>
            )}
          </div>
        </div>
      </header>

      {/* Address banner */}
      {tenant.property?.address && (
        <div className="bg-[var(--color-info-muted)] border-b border-[var(--color-info)]/20">
          <div className="max-w-6xl mx-auto px-4 py-2 flex items-center gap-2 text-sm text-[var(--color-info)]">
            <Building2 className="h-4 w-4 shrink-0" />
            <span>{tenant.property.address}</span>
          </div>
        </div>
      )}

      {/* Main */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6 flex-wrap h-auto gap-1">
            <TabsTrigger value="overview" className="flex items-center gap-2">
              <Home className="h-4 w-4" />
              {t("overview")}
            </TabsTrigger>
            <TabsTrigger value="payments" className="flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              {t("payments")}
            </TabsTrigger>
            <TabsTrigger value="maintenance" className="flex items-center gap-2">
              <Wrench className="h-4 w-4" />
              {t("maintenanceTab")}
            </TabsTrigger>
            <TabsTrigger value="documents" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {t("documentsTab")}
            </TabsTrigger>
          </TabsList>

          {/* ── Overview Tab ── */}
          <TabsContent value="overview" className="space-y-6">
            {!upcomingPayment && (
              <Card className="border-[var(--color-success)]/20 bg-[var(--color-success-muted)]">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2 text-[var(--color-success)]">
                    <CheckCircle2 className="h-5 w-5 text-[var(--color-success)]" />
                    {t("allCaughtUp")}
                  </CardTitle>
                  <CardDescription className="text-[var(--color-success)]">
                    {t("noDuePayments")}
                  </CardDescription>
                </CardHeader>
              </Card>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{t("monthlyRent")}</CardDescription>
                  <CardTitle className="text-2xl">{formatCurrency(tenant.rent)}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{t("paymentStatus")}</CardDescription>
                  <CardTitle>
                    <Badge className={getStatusColor(tenant.paymentStatus)}>
                      {tenant.paymentStatus === "current" ? (
                        <>
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          {t("current")}
                        </>
                      ) : (
                        <>
                          <Clock className="h-3 w-3 mr-1" />
                          {tStatus(tenant.paymentStatus)}
                        </>
                      )}
                    </Badge>
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{t("leaseEnds")}</CardDescription>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                    {formatDate(tenant.leaseEnd)}
                  </CardTitle>
                </CardHeader>
              </Card>
            </div>

            {upcomingPayment && (
              <Card
                className={
                  daysUntilDue && daysUntilDue < 0
                    ? "border-[var(--color-destructive)]/20 bg-[var(--color-error-muted)]"
                    : daysUntilDue && daysUntilDue <= 5
                      ? "border-[var(--color-warning)]/20 bg-[var(--color-warning-muted)]"
                      : ""
                }
              >
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    {daysUntilDue && daysUntilDue < 0 ? (
                      <AlertCircle className="h-5 w-5 text-[var(--color-destructive)]" />
                    ) : (
                      <Clock className="h-5 w-5 text-[var(--color-warning)]" />
                    )}
                    {daysUntilDue && daysUntilDue < 0
                      ? t("paymentOverdue", { days: Math.abs(daysUntilDue) })
                      : daysUntilDue === 0
                        ? t("paymentDueToday")
                        : t("paymentDueInDays", { days: daysUntilDue ?? 0 })}
                  </CardTitle>
                  <CardDescription>
                    {t("invoiceLabel")} {upcomingPayment.number} —{" "}
                    {formatCurrency(upcomingPayment.amount)}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    onClick={() => handlePayInvoice(upcomingPayment.id, upcomingPayment.amount)}
                    disabled={processingPayment === upcomingPayment.id}
                  >
                    {processingPayment === upcomingPayment.id ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {t("processing")}
                      </>
                    ) : (
                      <>
                        <CreditCard className="h-4 w-4 mr-2" />
                        {t("payNow")}
                      </>
                    )}
                  </Button>
                  {paymentMsg && (
                    <p
                      className={`mt-2 text-sm ${paymentMsg.type === "success" ? "text-[var(--color-success)]" : "text-[var(--color-destructive)]"}`}
                    >
                      {paymentMsg.text}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Property details */}
            {tenant.property && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{t("propertyDetails")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-[var(--color-muted-foreground)]">{t("property")}</span>
                    <span className="font-medium">{tenant.property.name}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between">
                    <span className="text-[var(--color-muted-foreground)]">{t("address")}</span>
                    <span className="font-medium">{tenant.property.address}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between">
                    <span className="text-[var(--color-muted-foreground)]">{t("leasePeriod")}</span>
                    <span className="font-medium">
                      {formatDate(tenant.leaseStart)} – {formatDate(tenant.leaseEnd)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Contact details with inline phone edit */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-lg">{t("contactInfo")}</CardTitle>
                {!editingPhone && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingPhone(true);
                      setPhoneMsg(null);
                    }}
                  >
                    <Phone className="h-4 w-4 mr-1" />
                    {t("editPhone")}
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-[var(--color-muted-foreground)]">Email</span>
                  <span className="font-medium">{tenant.email}</span>
                </div>
                <Separator />
                <div className="flex justify-between items-center gap-4">
                  <span className="text-[var(--color-muted-foreground)] shrink-0">
                    {t("editPhone")}
                  </span>
                  {editingPhone ? (
                    <div className="flex items-center gap-2 flex-1 justify-end">
                      <Input
                        value={phoneValue}
                        onChange={(e) => setPhoneValue(e.target.value)}
                        className="max-w-[180px]"
                        type="tel"
                      />
                      <Button size="sm" onClick={handleSavePhone} disabled={phoneSaving}>
                        {phoneSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("save")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingPhone(false);
                          setPhoneValue(tenant.phone);
                        }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <span className="font-medium">{tenant.phone}</span>
                  )}
                </div>
                {phoneMsg && (
                  <p
                    className={`text-sm ${phoneMsg.type === "success" ? "text-[var(--color-success)]" : "text-[var(--color-destructive)]"}`}
                  >
                    {phoneMsg.text}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Recent maintenance preview */}
            {maintenanceRequests.length > 0 && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-lg">{t("maintenanceRequests")}</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => setActiveTab("maintenance")}>
                    {t("viewAll")}
                  </Button>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {maintenanceRequests.slice(0, 3).map((req) => (
                      <div
                        key={req.id}
                        className="flex items-center justify-between p-3 bg-[var(--color-background)] rounded-lg"
                      >
                        <div>
                          <p className="font-medium">{req.title}</p>
                          <p className="text-sm text-[var(--color-muted-foreground)]">
                            {formatDate(req.createdAt)}
                          </p>
                        </div>
                        <Badge className={getStatusColor(req.status)}>
                          {req.status.replace("_", " ")}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── Payments Tab ── */}
          <TabsContent value="payments" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>{t("paymentHistory")}</CardTitle>
                <CardDescription>{t("yourRecentPayments")}</CardDescription>
              </CardHeader>
              <CardContent>
                {recentPayments.length === 0 ? (
                  <p className="text-[var(--color-muted-foreground)] text-center py-8">
                    {t("noPaymentHistory")}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {recentPayments.map((payment) => (
                      <div
                        key={payment.id}
                        className="flex items-center justify-between p-4 border border-[var(--color-border)] rounded-lg bg-[var(--color-card)]"
                      >
                        <div className="flex items-center gap-4">
                          <div
                            className={`p-2 rounded-full ${payment.status === "succeeded" ? "bg-[var(--color-success-muted)]" : "bg-[var(--color-secondary)]"}`}
                          >
                            {payment.status === "succeeded" ? (
                              <CheckCircle2 className="h-5 w-5 text-[var(--color-success)]" />
                            ) : (
                              <Clock className="h-5 w-5 text-[var(--color-muted-foreground)]" />
                            )}
                          </div>
                          <div>
                            <p className="font-medium text-[var(--color-foreground)]">
                              {formatCurrency(payment.amount)}
                            </p>
                            <p className="text-sm text-[var(--color-muted-foreground)]">
                              {formatDate(payment.date)} • {payment.method}
                              {payment.invoiceNumber && ` • ${payment.invoiceNumber}`}
                            </p>
                          </div>
                        </div>
                        <Badge className={getStatusColor(payment.status)}>
                          {tStatus(payment.status)}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  {t("invoices")}
                </CardTitle>
                <CardDescription>{t("yourBillingHistory")}</CardDescription>
              </CardHeader>
              <CardContent>
                {invoices.length === 0 ? (
                  <p className="text-[var(--color-muted-foreground)] text-center py-8">
                    {t("noInvoices")}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {invoices.map((invoice) => (
                      <div
                        key={invoice.id}
                        className="flex items-center justify-between p-4 border border-[var(--color-border)] rounded-lg bg-[var(--color-card)]"
                      >
                        <div>
                          <p className="font-medium text-[var(--color-foreground)]">
                            {invoice.number}
                          </p>
                          <p className="text-sm text-[var(--color-muted-foreground)]">
                            {t("due")}: {formatDate(invoice.dueDate)}
                            {invoice.paidDate && ` • ${t("paid")}: ${formatDate(invoice.paidDate)}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-medium text-[var(--color-foreground)]">
                            {formatCurrency(invoice.amount)}
                          </span>
                          <Badge className={getStatusColor(invoice.status)}>
                            {tStatus(invoice.status)}
                          </Badge>
                          {invoice.status !== "paid" && (
                            <Button
                              size="sm"
                              onClick={() => handlePayInvoice(invoice.id, invoice.amount)}
                              disabled={processingPayment === invoice.id}
                            >
                              {processingPayment === invoice.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                t("pay")
                              )}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {paymentMsg && (
                  <p
                    className={`mt-3 text-sm ${paymentMsg.type === "success" ? "text-[var(--color-success)]" : "text-[var(--color-destructive)]"}`}
                  >
                    {paymentMsg.text}
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Maintenance Tab ── */}
          <TabsContent value="maintenance" className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">{t("maintenanceTab")}</h2>
              {!showCreateForm && (
                <Button
                  onClick={() => {
                    setShowCreateForm(true);
                    setSubmitMsg(null);
                  }}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {t("reportIssue")}
                </Button>
              )}
            </div>

            {/* Create form */}
            {showCreateForm && (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-lg">{t("reportIssue")}</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => setShowCreateForm(false)}>
                    <X className="h-4 w-4" />
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1">
                    <Label htmlFor="req-title">{t("titleLabel")}</Label>
                    <Input
                      id="req-title"
                      value={formTitle}
                      onChange={(e) => setFormTitle(e.target.value)}
                      maxLength={200}
                      placeholder={t("titleLabel")}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="req-desc">{t("descriptionLabel")}</Label>
                    <Textarea
                      id="req-desc"
                      value={formDesc}
                      onChange={(e) => setFormDesc(e.target.value)}
                      rows={4}
                      placeholder={t("descriptionLabel")}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="req-priority">{t("priorityLabel")}</Label>
                    <Select
                      value={formPriority}
                      onValueChange={(v) => setFormPriority(v as typeof formPriority)}
                    >
                      <SelectTrigger id="req-priority">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">{t("priorityLow")}</SelectItem>
                        <SelectItem value="medium">{t("priorityMedium")}</SelectItem>
                        <SelectItem value="high">{t("priorityHigh")}</SelectItem>
                        <SelectItem value="urgent">{t("priorityUrgent")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {submitMsg && (
                    <p
                      className={`text-sm ${submitMsg.type === "success" ? "text-[var(--color-success)]" : "text-[var(--color-destructive)]"}`}
                    >
                      {submitMsg.text}
                    </p>
                  )}
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" onClick={() => setShowCreateForm(false)}>
                      {t("cancel")}
                    </Button>
                    <Button
                      onClick={handleSubmitRequest}
                      disabled={submitting || !formTitle.trim() || !formDesc.trim()}
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          {t("submitting")}
                        </>
                      ) : (
                        t("submitRequest")
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Ticket list */}
            <Card>
              <CardContent className="pt-6">
                {ticketsLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-[var(--color-muted-foreground)]" />
                  </div>
                ) : tickets.length === 0 ? (
                  <div className="text-center py-12">
                    <Wrench className="h-10 w-10 mx-auto text-[var(--color-muted-foreground)] mb-3" />
                    <p className="text-[var(--color-muted-foreground)]">
                      {t("noMaintenanceRequests")}
                    </p>
                    <Button
                      variant="outline"
                      className="mt-4"
                      onClick={() => setShowCreateForm(true)}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      {t("reportIssue")}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {tickets.map((ticket) => (
                      <div
                        key={ticket.id}
                        className="p-4 border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium text-[var(--color-foreground)]">
                            {ticket.title}
                          </p>
                          <div className="flex gap-2 shrink-0">
                            <Badge variant="outline" className={getStatusColor(ticket.priority)}>
                              {t(PORTAL_PRIORITY_KEY[ticket.priority] ?? "priorityMedium")}
                            </Badge>
                            <Badge className={getStatusColor(ticket.status)}>
                              {tMaint(
                                TICKET_STATUS_KEY[ticket.status as TicketStatus] ?? "statusOpen",
                              )}
                            </Badge>
                          </div>
                        </div>
                        <p className="text-sm text-[var(--color-muted-foreground)] line-clamp-2">
                          {ticket.description}
                        </p>
                        <p className="text-xs text-[var(--color-muted-foreground)]">
                          {formatDate(ticket.createdAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Documents Tab ── */}
          <TabsContent value="documents" className="space-y-6">
            <h2 className="text-xl font-semibold">{t("documentsTab")}</h2>
            <Card>
              <CardContent className="pt-6">
                {docsLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-[var(--color-muted-foreground)]" />
                  </div>
                ) : documents.length === 0 ? (
                  <div className="text-center py-12">
                    <FileText className="h-10 w-10 mx-auto text-[var(--color-muted-foreground)] mb-3" />
                    <p className="text-[var(--color-muted-foreground)]">{t("noDocuments")}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {documents.map((doc) => (
                      <div
                        key={doc.id}
                        className="flex items-center justify-between p-4 border border-[var(--color-border)] rounded-lg bg-[var(--color-card)]"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <FileText className="h-8 w-8 text-[var(--color-muted-foreground)] shrink-0" />
                          <div className="min-w-0">
                            <p className="font-medium text-[var(--color-foreground)] truncate">
                              {doc.name}
                            </p>
                            <p className="text-sm text-[var(--color-muted-foreground)]">
                              {tDoc(doc.type)} • {formatFileSize(doc.fileSize)} •{" "}
                              {formatDate(doc.createdAt)}
                            </p>
                            {doc.expiresAt && (
                              <p className="text-xs text-[var(--color-warning)]">
                                {t("docExpires", { date: formatDate(doc.expiresAt) })}
                              </p>
                            )}
                          </div>
                        </div>
                        <a
                          href={`/api/tenant-portal/${token}/documents/${doc.id}`}
                          download={doc.name}
                          className="shrink-0 ml-4"
                        >
                          <Button variant="outline" size="sm">
                            <Download className="h-4 w-4 mr-2" />
                            {t("download")}
                          </Button>
                        </a>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      <footer className="border-t border-[var(--color-border)] bg-[var(--color-card-solid)] mt-auto">
        <div className="max-w-6xl mx-auto px-4 py-4 text-center text-sm text-[var(--color-muted-foreground)]">
          {t("needHelp")}
        </div>
      </footer>
    </div>
  );
}

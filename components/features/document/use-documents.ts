"use client";

import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/utils/api-client";
import { useDemoMode } from "@/lib/contexts/demo-context";
import { useApiError } from "@/lib/utils/api-error";
import { usePortalAccess } from "@/lib/contexts/portal-context";
import type { Document, DocumentStats, DocumentRef, DocumentType } from "./document-types";

interface UseDocumentsOptions {
  csrfToken: string | null;
  sessionReady: boolean;
  typeFilter: DocumentType | "all";
  propertyFilter: string;
  searchTerm: string;
}

interface UseDocumentsReturn {
  documents: Document[];
  stats: DocumentStats | null;
  properties: DocumentRef[];
  tenants: DocumentRef[];
  owners: DocumentRef[];
  loading: boolean;
  error: string | null;
  setError: (error: string | null) => void;
  refetch: () => void;
  handleDownload: (doc: Document) => Promise<void>;
  handleDelete: (id: string) => Promise<void>;
}

export function useDocuments({
  csrfToken,
  sessionReady,
  typeFilter,
  propertyFilter,
  searchTerm,
}: UseDocumentsOptions): UseDocumentsReturn {
  const { isDemoMode } = useDemoMode();
  const { isOwnerPortal } = usePortalAccess();

  const [documents, setDocuments] = useState<Document[]>([]);
  const [stats, setStats] = useState<DocumentStats | null>(null);
  const [properties, setProperties] = useState<DocumentRef[]>([]);
  const [tenants, setTenants] = useState<DocumentRef[]>([]);
  const [owners, setOwners] = useState<DocumentRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const apiError = useApiError();

  const fetchDocuments = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (propertyFilter !== "all") params.set("propertyId", propertyFilter);
      if (searchTerm) params.set("search", searchTerm);

      const data = await apiFetch<{ data: Document[] } | Document[]>(
        `/api/documents?${params}`,
        csrfToken,
      );
      setDocuments(Array.isArray(data) ? data : data.data || []);
    } catch (err) {
      setError(apiError(err));
    }
  }, [typeFilter, propertyFilter, searchTerm, csrfToken, apiError]);

  const fetchStats = useCallback(async () => {
    if (isDemoMode) return;
    try {
      const data = await apiFetch<{ data: DocumentStats } | DocumentStats>(
        "/api/documents/stats",
        csrfToken,
      );
      setStats((data as { data: DocumentStats }).data ?? (data as DocumentStats));
    } catch (err) {
      console.error("Failed to fetch stats:", err);
    }
  }, [csrfToken, isDemoMode]);

  const fetchReferenceData = useCallback(async () => {
    try {
      const [propsData, tenantsData, ownersData] = await Promise.all([
        apiFetch<{ data: DocumentRef[] } | DocumentRef[]>("/api/properties", csrfToken),
        apiFetch<{ data: DocumentRef[] } | DocumentRef[]>("/api/tenants", csrfToken),
        isOwnerPortal
          ? apiFetch<{ data: DocumentRef[] } | DocumentRef[]>("/api/owners", csrfToken)
          : Promise.resolve([] as DocumentRef[]),
      ]);
      setProperties(Array.isArray(propsData) ? propsData : propsData.data || []);
      setTenants(Array.isArray(tenantsData) ? tenantsData : tenantsData.data || []);
      setOwners(Array.isArray(ownersData) ? ownersData : ownersData.data || []);
    } catch (err) {
      console.error("Failed to fetch reference data:", err);
    }
  }, [csrfToken, isOwnerPortal]);

  useEffect(() => {
    if (sessionReady) {
      Promise.all([fetchDocuments(), fetchStats(), fetchReferenceData()]).finally(() =>
        setLoading(false),
      );
    }
  }, [fetchDocuments, fetchReferenceData, fetchStats, sessionReady]);

  // Compute stats from documents in demo mode
  useEffect(() => {
    if (!isDemoMode) return;
    const byType = documents.reduce<Record<string, number>>((acc, doc) => {
      acc[doc.type] = (acc[doc.type] || 0) + 1;
      return acc;
    }, {});
    setStats({
      totalDocuments: documents.length,
      totalSize: documents.reduce((sum, doc) => sum + doc.fileSize, 0),
      byType,
    });
  }, [documents, isDemoMode]);

  const handleDownload = async (doc: Document) => {
    try {
      const response = await fetch(`/api/documents/${doc.id}/download`);
      if (!response.ok) throw new Error("Download failed");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(apiError(err));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiFetch(`/api/documents/${id}`, csrfToken, "DELETE");
      fetchDocuments();
      fetchStats();
    } catch (err) {
      setError(apiError(err));
    }
  };

  return {
    documents,
    stats,
    properties,
    tenants,
    owners,
    loading,
    error,
    setError,
    refetch: () => {
      fetchDocuments();
      fetchStats();
    },
    handleDownload,
    handleDelete,
  };
}

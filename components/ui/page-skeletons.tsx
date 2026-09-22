"use client";

import { motion } from "framer-motion";
import { Skeleton } from "./skeleton";
import { Card, CardContent, CardHeader } from "./card";
import { cn } from "@/lib/utils/utils";

/** Dashboard skeleton with stat cards, charts, and activity feed */
export function DashboardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-6", className)}>
      {/* Header skeleton */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="hidden lg:flex items-center gap-2">
          <Skeleton className="h-9 w-28 rounded-md" />
          <Skeleton className="h-9 w-28 rounded-md" />
          <Skeleton className="h-9 w-9 rounded-md" />
        </div>
      </div>

      {/* Onboarding checklist skeleton */}
      <Skeleton className="h-14 w-full rounded-xl" />

      {/* Stat cards skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
        {[1, 2, 3, 4].map((i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
          >
            <Card>
              <CardContent className="p-4 md:p-6">
                <div className="flex items-center gap-3 mb-3">
                  <Skeleton className="h-9 w-9 rounded-lg" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-7 w-16 mb-2" />
                <Skeleton className="h-3 w-20" />
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Chart skeletons */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        {[1, 2].map((i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 + i * 0.1 }}
          >
            <Card>
              <CardHeader>
                <Skeleton className="h-5 w-32 mb-1" />
                <Skeleton className="h-3 w-48" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-48 w-full rounded-lg" />
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Activity list skeleton */}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-36 mb-1" />
          <Skeleton className="h-3 w-44" />
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3].map((i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.5 + i * 0.08 }}
              className="flex items-center gap-3"
            >
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
              </div>
              <Skeleton className="h-3 w-16" />
            </motion.div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/** Properties / Assets list skeleton */
export function PropertiesListSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-24 rounded-md" />
          <Skeleton className="h-9 w-32 rounded-md" />
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4"
          >
            <Skeleton className="h-3 w-20 mb-2" />
            <Skeleton className="h-6 w-12" />
          </motion.div>
        ))}
      </div>

      {/* Search bar */}
      <Skeleton className="h-10 w-full max-w-sm rounded-md" />

      {/* Table skeleton */}
      <div className="rounded-lg border border-[var(--color-border)] overflow-hidden">
        {/* Table header */}
        <div className="flex gap-4 p-3 bg-[var(--color-muted)]/30 border-b border-[var(--color-border)]">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-3 flex-1" />
          ))}
        </div>
        {/* Table rows */}
        {[1, 2, 3, 4, 5].map((row) => (
          <motion.div
            key={row}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 + row * 0.05 }}
            className="flex gap-4 p-3 border-b border-[var(--color-border)] last:border-b-0"
          >
            {[1, 2, 3, 4, 5].map((col) => (
              <Skeleton
                key={col}
                className="h-4 flex-1"
                style={{ width: `${60 + Math.random() * 30}%` }}
              />
            ))}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/** People / Tenants list skeleton */
export function PeopleListSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-9 w-24 rounded-md" />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4"
          >
            <Skeleton className="h-3 w-20 mb-2" />
            <Skeleton className="h-6 w-12" />
          </motion.div>
        ))}
      </div>

      {/* Tabs skeleton */}
      <div className="flex gap-4 border-b border-[var(--color-border)] pb-2">
        <Skeleton className="h-8 w-24 rounded-md" />
        <Skeleton className="h-8 w-24 rounded-md" />
      </div>

      {/* Cards grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 + i * 0.06 }}
          >
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3 mb-3">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/** Generic page skeleton fallback */
export function GenericPageSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-6", className)}>
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: i * 0.1 }}
          >
            <Card>
              <CardContent className="p-6">
                <div className="space-y-3">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-4/5" />
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/** Financial / Invoices / Receipts view skeleton */
export function FinancialSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-4 w-60" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-28 rounded-lg" />
          <Skeleton className="h-9 w-28 rounded-lg" />
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
          >
            <Card>
              <CardContent className="p-4">
                <Skeleton className="h-3 w-20 mb-2" />
                <Skeleton className="h-7 w-24 mb-1" />
                <Skeleton className="h-3 w-16" />
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-64 rounded-lg" />
        <Skeleton className="h-10 w-32 rounded-lg" />
      </div>

      {/* Table rows */}
      <Card>
        <CardContent className="p-0">
          <div className="border-b border-[var(--color-inner-border)] p-3 flex gap-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-3 flex-1" />
            ))}
          </div>
          {[1, 2, 3, 4, 5, 6].map((row) => (
            <motion.div
              key={row}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 + row * 0.04 }}
              className="flex gap-4 p-3 border-b border-[var(--color-inner-border)] last:border-b-0"
            >
              {[1, 2, 3, 4, 5].map((col) => (
                <Skeleton key={col} className="h-4 flex-1" />
              ))}
            </motion.div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/** Leases / Contracts view skeleton */
export function LeasesSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-4 w-52" />
        </div>
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>

      {/* Status badges row */}
      <div className="flex gap-2">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-7 w-20 rounded-full" />
        ))}
      </div>

      {/* Lease cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {[1, 2, 3, 4].map((i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.07 }}
          >
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-5 w-36" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-4 rounded" />
                  <Skeleton className="h-4 w-32" />
                </div>
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-4 rounded" />
                  <Skeleton className="h-4 w-28" />
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-[var(--color-inner-border)]">
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";

interface ReleaseInfo {
  tag_name?: string;
  tag?: string;
  name?: string;
  html_url?: string;
}

function compareVersions(a?: string, b?: string): number {
  if (!a || !b) return 0;
  const pa = a
    .replace(/^v/, "")
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  const pb = b
    .replace(/^v/, "")
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

export function UpdateBanner(): React.ReactElement | null {
  const t = useTranslations("common");
  const sess = useSession();
  const session = sess?.data;
  const [latest] = useState<ReleaseInfo | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [dismissedTag, setDismissedTag] = useState<string | null>(null);

  useEffect(() => {
    // load current version
    (async () => {
      try {
        const res = await fetch("/version.json");
        if (!res.ok) return;
        const j = await res.json();
        setCurrent(j.version || null);
      } catch {
        // ignore
      }
    })();

    setDismissedTag(localStorage.getItem("situs.dismissedUpdate") || null);
  }, []);

  useEffect(() => {
    // Update checks removed: /api/updates webhook has been removed.
    // Keeping the component inert; it will not fetch remote updates.
    // If you want update checks later, reintroduce a protected endpoint and fetch here.
  }, []);

  // Only admins should see this
  const userRole = (session?.user as { role?: string })?.role;
  if (!session || userRole !== "ADMIN") return null;
  if (!latest || !current) return null;
  const latestTag = latest.tag_name || latest.tag || latest.name;
  if (!latestTag) return null;
  if (dismissedTag === latestTag) return null;

  const cmp = compareVersions(latestTag, current);
  if (cmp <= 0) return null;

  return (
    <div className="border border-[var(--semantic-warning)] bg-[var(--semantic-warning-soft)] text-[var(--color-foreground)] p-3 mb-4 mx-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <strong className="block">New release available: {latest.name || latest.tag_name}</strong>
          <p className="text-sm mt-1">
            A new version of Situs is available.{" "}
            <a className="underline" href={latest.html_url || "#"} target="_blank" rel="noreferrer">
              {t("viewReleaseNotes")}
            </a>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="https://github.com/JIGLE/situs/blob/main/docs/truenas.md">
            <a className="text-sm px-3 py-1 bg-white/60 border">{t("upgradeDocs")}</a>
          </Link>
          <button
            className="text-sm text-muted-foreground"
            onClick={() => {
              localStorage.setItem("situs.dismissedUpdate", latestTag);
              setDismissedTag(latestTag);
            }}
          >
            {t("dismiss")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default UpdateBanner;

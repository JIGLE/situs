"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";

type EventPrimitive = string | number | boolean;

interface LandingAnalyticsObserverProps {
  locale: string;
}

interface TrackedLandingLinkProps {
  href: string;
  className?: string;
  prefetch?: boolean;
  eventName: string;
  eventData?: Record<string, EventPrimitive | undefined>;
  children: ReactNode;
}

function toEventValue(value: EventPrimitive): string {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value);
}

export function trackLandingEvent(
  eventName: string,
  eventData?: Record<string, EventPrimitive | undefined>,
): void {
  if (typeof window === "undefined") return;

  const params = new URLSearchParams({ name: eventName });
  if (eventData) {
    for (const [key, value] of Object.entries(eventData)) {
      if (value !== undefined) {
        params.set(key, toEventValue(value));
      }
    }
  }

  void fetch(`/api/monitoring/track?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
    keepalive: true,
  }).catch(() => {
    // Ignore analytics delivery errors.
  });
}

export function TrackedLandingLink({
  href,
  className,
  prefetch,
  eventName,
  eventData,
  children,
}: TrackedLandingLinkProps) {
  return (
    <Link
      href={href}
      className={className}
      prefetch={prefetch}
      onClick={() => trackLandingEvent(eventName, eventData)}
    >
      {children}
    </Link>
  );
}

export function LandingAnalyticsObserver({ locale }: LandingAnalyticsObserverProps) {
  const trackedPageView = useRef(false);
  const trackedDepths = useRef(new Set<number>());

  useEffect(() => {
    if (trackedPageView.current) return;

    trackLandingEvent("landing.page_view", {
      locale,
    });
    trackedPageView.current = true;
  }, [locale]);

  useEffect(() => {
    const depthMilestones = [50, 90];

    const onScroll = () => {
      const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollableHeight <= 0) return;

      const depth = Math.round((window.scrollY / scrollableHeight) * 100);
      depthMilestones.forEach((milestone) => {
        if (depth >= milestone && !trackedDepths.current.has(milestone)) {
          trackedDepths.current.add(milestone);
          trackLandingEvent("landing.scroll_depth", {
            locale,
            depth: milestone,
          });
        }
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, [locale]);

  return null;
}

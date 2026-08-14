"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useAuthMe } from "@/contexts/AuthDataContext";

/**
 * Persistent profile reminder shown when a player dismissed the one-time stat
 * allocation gate (`statAllocationDismissed`) without finishing. Clicking it
 * clears the dismissal and refetches auth, which re-opens the global
 * `StatAllocationGate` modal so they can pick up where they left off.
 */
export function StatAllocationBanner() {
  const t = useTranslations("profile.statAllocation");
  const { refetch } = useAuthMe();
  const [returning, setReturning] = useState(false);
  const [opened, setOpened] = useState(false);

  if (opened) return null;

  async function handleReturn() {
    if (returning) return;
    setReturning(true);
    try {
      await fetch("/api/character/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statAllocationDismissed: false }),
      });
      refetch(true);
      setOpened(true);
    } catch {
      setReturning(false);
    }
  }

  return (
    <button
      onClick={handleReturn}
      disabled={returning}
      className="w-full rounded-xl border border-primary/30 bg-card px-4 py-3 shadow-card flex items-center justify-between gap-4 text-left transition-colors hover:border-primary/60 disabled:opacity-60"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{t("title")}</span>
        <span className="mt-0.5 block text-xs text-muted">{t("body")}</span>
      </span>
      <span className="shrink-0 text-xs font-medium text-primary">
        {returning ? t("opening") : t("returnToStats")}
      </span>
    </button>
  );
}

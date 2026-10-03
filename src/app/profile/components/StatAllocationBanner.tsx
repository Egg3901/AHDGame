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
      className="flex w-full items-center justify-between gap-4 rounded-md border border-card-border px-3 py-2 text-left transition-colors hover:bg-card-elevated/50 disabled:opacity-60"
    >
      <span className="min-w-0 flex-1 truncate text-body">
        <span className="font-medium text-foreground">{t("title")}</span>
        <span className="hidden text-muted sm:inline"> {t("body")}</span>
      </span>
      <span className="shrink-0 text-body-sm font-medium text-primary">
        {returning ? t("opening") : t("returnToStats")}
      </span>
    </button>
  );
}

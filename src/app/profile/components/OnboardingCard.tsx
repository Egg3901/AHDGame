"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

export function NewPlayerBanner() {
  const t = useTranslations("profile.onboarding");
  const [dismissed, setDismissed] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  if (dismissed) return null;

  async function handleDismiss(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDismissing(true);
    try {
      await fetch("/api/character/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onboardingDismissed: true }),
      });
      setDismissed(true);
    } catch {
      setDismissing(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-card-border px-3 py-2">
      <Link
        href="/actions/suggestions"
        className="min-w-0 flex-1 truncate text-body underline-offset-4 hover:underline"
      >
        <span className="font-medium text-foreground">{t("newTitle")}</span>
        <span className="hidden text-muted sm:inline"> {t("newSubtitle")}</span>
      </Link>
      <button
        onClick={handleDismiss}
        disabled={dismissing}
        className="shrink-0 text-body-sm text-muted transition-colors hover:text-foreground"
        aria-label={t("newDismissAria")}
      >
        {t("dismiss")}
      </button>
    </div>
  );
}

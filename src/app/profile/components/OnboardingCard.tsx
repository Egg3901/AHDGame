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
    <div className="rounded-xl border border-primary/30 bg-card px-4 py-3 shadow-card flex items-center justify-between gap-4">
      <Link href="/actions/suggestions" className="flex-1 group min-w-0">
        <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
          {t("newTitle")}
        </p>
        <p className="text-xs text-muted mt-0.5 group-hover:text-primary/70 transition-colors">
          {t("newSubtitle")}
        </p>
      </Link>
      <button
        onClick={handleDismiss}
        disabled={dismissing}
        className="shrink-0 text-xs text-muted hover:text-foreground transition-colors"
        aria-label={t("newDismissAria")}
      >
        {t("dismiss")}
      </button>
    </div>
  );
}

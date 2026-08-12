"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { Button } from "@/components/ui/Button";

export interface OnboardingChecklistCardStep {
  id: string;
  title: string;
  body: string;
  link: string;
  done: boolean;
}

interface OnboardingChecklistProps {
  steps: OnboardingChecklistCardStep[];
  completedCount: number;
  total: number;
  /** Anchor-denominated (₳) completion reward. */
  rewardAmount: number;
}

/**
 * New-player onboarding checklist card (profile page). Steps derive from the
 * canonical definitions in src/lib/onboarding/checklist.ts; the server passes
 * pre-derived completion state. Dismissal persists via PATCH /api/character/me
 * and the reward claim goes through POST /api/onboarding/claim (idempotent
 * server-side).
 */
export function OnboardingChecklist({
  steps,
  completedCount,
  total,
  rewardAmount,
}: OnboardingChecklistProps) {
  const t = useTranslations("profile.onboarding");
  const locale = useLocale();
  const [dismissed, setDismissed] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  if (dismissed) return null;

  const allComplete = completedCount === total;
  const progressPct = total > 0 ? Math.round((completedCount / total) * 100) : 0;
  const rewardLabel = `₳${rewardAmount.toLocaleString(locale)}`;

  async function handleDismiss() {
    setDismissing(true);
    try {
      const res = await fetch("/api/character/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onboardingDismissed: true }),
      });
      // Only hide the card when the dismissal persisted; a rate-limit or
      // server error would otherwise resurrect it on the next visit.
      if (res.ok) {
        setDismissed(true);
      } else {
        setDismissing(false);
      }
    } catch {
      setDismissing(false);
    }
  }

  async function handleClaim() {
    setClaiming(true);
    setClaimError(null);
    try {
      const res = await fetch("/api/onboarding/claim", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setClaimed(true);
      } else {
        setClaimError(data?.error ?? t("claimFailed"));
      }
    } catch {
      setClaimError(t("claimFailed"));
    } finally {
      setClaiming(false);
    }
  }

  return (
    <section
      aria-label={t("checklistAria")}
      className="rounded-lg border border-card-border bg-card shadow-card"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 pt-3">
        <div className="flex items-baseline gap-2 min-w-0">
          <h2 className="text-heading-sm font-semibold text-foreground">{t("title")}</h2>
          <span className="text-body-xs text-muted whitespace-nowrap">
            {t("progress", { completed: completedCount, total })}
          </span>
        </div>
        <button
          onClick={handleDismiss}
          disabled={dismissing}
          className="shrink-0 text-body-xs text-muted hover:text-foreground transition-colors"
          aria-label={t("dismissChecklistAria")}
        >
          {t("dismiss")}
        </button>
      </div>

      {/* Progress bar */}
      <div className="mx-4 mt-2 h-1 rounded-full bg-track overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Steps */}
      <ul className="mt-1 divide-y divide-card-border/60">
        {steps.map((step, index) => (
          <li key={step.id} className="flex items-start gap-3 px-4 py-2.5">
            {step.done ? (
              <span
                aria-hidden
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success text-body-xs font-bold"
              >
                ✓
              </span>
            ) : (
              <span
                aria-hidden
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-card-border text-muted text-body-xs font-semibold"
              >
                {index + 1}
              </span>
            )}
            <div className="min-w-0 flex-1">
              {step.done ? (
                <p className="text-body-sm text-muted">
                  {step.title}
                  <span className="sr-only"> {t("doneSr")}</span>
                </p>
              ) : (
                <>
                  <Link
                    href={step.link}
                    className="text-body-sm font-medium text-foreground hover:text-primary transition-colors"
                  >
                    {step.title}
                    <span aria-hidden className="ml-1 text-muted">
                      →
                    </span>
                  </Link>
                  <p className="mt-0.5 text-body-xs text-muted leading-relaxed">{step.body}</p>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      {/* Reward footer */}
      <div className="border-t border-card-border/60 px-4 py-3">
        {claimed ? (
          <p className="text-body-sm text-success">{t("rewardAdded", { reward: rewardLabel })}</p>
        ) : allComplete ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={handleClaim} isLoading={claiming}>
              {t("claim", { reward: rewardLabel })}
            </Button>
            {claimError && <p className="text-body-xs text-error">{claimError}</p>}
          </div>
        ) : (
          <p className="text-body-xs text-muted">
            {t("finishSteps", { total, reward: rewardLabel })}
          </p>
        )}
      </div>
    </section>
  );
}

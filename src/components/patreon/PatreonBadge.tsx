"use client";

import type { PatreonTier, SupporterProvider } from "@/lib/db/types";
import { formatStableUtc } from "@/lib/time/localTime";

interface PatreonBadgeProps {
  tier: PatreonTier;
  expiresAt?: string | Date | null;
  since?: string | Date | null;
  /** Which system granted the benefits; drives provider-neutral tooltip copy. */
  provider?: SupporterProvider;
  className?: string;
}

function formatSupporterDuration(since: Date): string {
  const now = new Date();
  const months =
    (now.getFullYear() - since.getFullYear()) * 12 + (now.getMonth() - since.getMonth());

  if (months <= 0) return "less than 1 month";
  if (months < 12) return `${months} month${months === 1 ? "" : "s"}`;

  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  if (remainingMonths === 0) return `${years} year${years === 1 ? "" : "s"}`;
  return `${years}y ${remainingMonths}m`;
}

export function PatreonBadge({
  tier,
  expiresAt,
  since,
  provider,
  className = "",
}: PatreonBadgeProps) {
  if (!tier) return null;

  const isPlusPlus = tier === "supporter-plus-plus";
  const isPlus = tier === "supporter-plus";
  const label = isPlusPlus ? "Supporter++" : isPlus ? "Supporter+" : "Supporter";
  const titleParts = [label];
  if (provider === "stripe") {
    titleParts.push("(Lakeside subscription)");
  }
  if (since) {
    const sinceDate = new Date(since);
    titleParts.push(
      `since ${formatStableUtc(sinceDate, {
        month: "long",
        year: "numeric",
      })}`
    );
    titleParts.push(`(${formatSupporterDuration(sinceDate)})`);
  }
  if (expiresAt) {
    // wall-clock by design: patreon subscription billing runs on real time
    titleParts.push(
      `active until ${formatStableUtc(expiresAt, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })}`
    );
  }
  const title = titleParts.join(" ");

  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] shadow-sm ${
        isPlusPlus
          ? "border-violet-300/70 bg-gradient-to-r from-violet-300 via-fuchsia-200 to-amber-200 text-violet-950 ring-1 ring-violet-400/40"
          : isPlus
            ? "border-amber-300/60 bg-gradient-to-r from-amber-200 via-yellow-100 to-amber-300 text-amber-950"
            : "border-slate-300/80 bg-gradient-to-r from-slate-100 via-white to-slate-200 text-slate-700"
      } ${className}`}
    >
      {label}
    </span>
  );
}

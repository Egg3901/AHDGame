"use client";

import { useTranslations } from "next-intl";
import { brandShades, resolveCorpColor } from "@/lib/corporations/brandColor";
import { shareholderVotingPower, totalVotingPower } from "@/lib/corporations/superShares";
import { ownershipPercent } from "@/lib/corporations/ownership/rules";
import type { CorporationDetail, ShareholderInfo } from "../CorporationPageTypes";
import { DenseSection } from "../dense/DenseKit";

export function currentOwnerKey(holder: ShareholderInfo): string {
  const kind = holder.isFund
    ? "fund"
    : holder.isNpp
      ? "npp"
      : holder.isImperial
        ? "imperial"
        : holder.corporationId && !holder.characterId
          ? "corporation"
          : "character";
  return `${kind}:${holder.characterId ?? holder.corporationId ?? holder.name}`;
}

export default function OwnershipOverview({ corporation }: { corporation: CorporationDetail }) {
  const t = useTranslations("corporations.ownership");
  const total = corporation.totalShares;
  const votingTotal = totalVotingPower(corporation);
  const holders = corporation.shareholders
    .filter((h) => h.shares > 0)
    .sort((a, b) => b.shares - a.shares);
  const colors = brandShades(
    resolveCorpColor(corporation.brandColor, corporation._id),
    Math.min(holders.length, 5)
  );
  const rows = holders.slice(0, 5).map((holder, index) => ({
    key: currentOwnerKey(holder),
    name: holder.name,
    shares: holder.shares,
    votes: shareholderVotingPower(corporation, holder),
    color: colors[index],
  }));
  const tail = holders.slice(5);
  if (tail.length)
    rows.push({
      key: "other",
      name: t("otherHolders"),
      shares: tail.reduce((s, h) => s + h.shares, 0),
      votes: tail.reduce((s, h) => s + shareholderVotingPower(corporation, h), 0),
      color: "var(--muted)",
    });
  if (corporation.publicFloat > 0)
    rows.push({
      key: "float",
      name: t("publicFloat"),
      shares: corporation.publicFloat,
      votes: corporation.publicFloat,
      color: "var(--muted)",
    });
  const remainder = total - rows.reduce((sum, row) => sum + row.shares, 0);
  if (remainder > 0)
    rows.push({
      key: "unassigned",
      name: t("unassigned"),
      shares: remainder,
      votes: 0,
      color: "var(--card-border)",
    });
  const circumference = 2 * Math.PI * 68;
  const chartValid = total > 0 && remainder >= 0;

  return (
    <DenseSection title={t("currentTitle")} meta={t("liveRegister")}>
      <div className="grid gap-6 py-4 md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="flex items-center justify-center">
          {chartValid ? (
            <svg
              viewBox="0 0 180 180"
              className="h-44 w-44"
              role="img"
              aria-label={t("splitChart")}
            >
              <title>
                {rows
                  .map((r) => `${r.name}: ${ownershipPercent(r.shares, total).toFixed(1)}%`)
                  .join(", ")}
              </title>
              {rows.map((row, index) => {
                const length = (row.shares / total) * circumference;
                const start = rows
                  .slice(0, index)
                  .reduce((sum, prior) => sum + (prior.shares / total) * circumference, 0);
                return (
                  <circle
                    key={row.key}
                    cx="90"
                    cy="90"
                    r="68"
                    fill="none"
                    stroke={row.color}
                    strokeWidth="22"
                    strokeDasharray={`${length} ${circumference - length}`}
                    strokeDashoffset={-start}
                    transform="rotate(-90 90 90)"
                  />
                );
              })}
              <text
                x="90"
                y="87"
                textAnchor="middle"
                fill="var(--foreground)"
                className="font-mono text-2xl"
              >
                {holders.length}
              </text>
              <text x="90" y="107" textAnchor="middle" fill="var(--muted)" className="text-xs">
                {t("holdersLabel")}
              </text>
            </svg>
          ) : (
            <p className="text-xs text-muted">{t("unavailableSplit")}</p>
          )}
        </div>
        <div className="min-w-0">
          <div className="grid grid-cols-[minmax(0,1fr)_76px_76px] gap-3 border-b border-card-border pb-2 text-[11px] text-muted">
            <span>{t("holder")}</span>
            <span className="text-right">{t("ownership")}</span>
            <span className="text-right">{t("votingPower")}</span>
          </div>
          {rows.map((row) => (
            <div
              key={row.key}
              className="grid grid-cols-[minmax(0,1fr)_76px_76px] items-center gap-3 border-b border-card-border/60 py-2.5 text-xs"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0" style={{ background: row.color }} />
                  <span className="truncate" title={row.name}>
                    {row.name}
                  </span>
                </div>
                <div className="mt-1.5 h-1 bg-card-border/40">
                  <div
                    className="h-full"
                    style={{
                      width: `${Math.min(100, ownershipPercent(row.shares, total))}%`,
                      background: row.color,
                    }}
                  />
                </div>
              </div>
              <span className="text-right font-mono tabular-nums">
                {ownershipPercent(row.shares, total).toFixed(1)}%
              </span>
              <span className="text-right font-mono tabular-nums text-muted">
                {row.key === "unassigned"
                  ? t("unallocatedVotes")
                  : `${ownershipPercent(row.votes, votingTotal).toFixed(1)}%`}
              </span>
            </div>
          ))}
          <p className="mt-3 text-[11px] leading-relaxed text-muted">{t("votingExplanation")}</p>
          {remainder > 0 && (
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              {t("unassignedExplanation")}
            </p>
          )}
        </div>
      </div>
    </DenseSection>
  );
}

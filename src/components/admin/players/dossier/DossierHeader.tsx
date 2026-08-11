"use client";

// DossierHeader — the cockpit's hero strip: who this account is, whether it
// is banned, and the one risk figure (strongest alt link/ring confidence) as
// the focal ConfidenceMeter, backed by the same accent radial the cluster
// detail header uses. Below: the vital signs (links / rings / flags / net
// money / age) and the active suspicious-character chips.

import { ConfidenceMeter } from "@/components/admin/alts/ConfidenceMeter";
import { confidenceHex } from "@/components/admin/alts/altTypes";
import {
  activeFlagCount,
  formatCompactAmount,
  formatDateTime,
  OVERLINE_CLS,
  SEVERITY_BADGE,
  strongestAltConfidence,
  type DossierContext,
  type DossierResponse,
} from "./dossierTypes";
import { formatRelative } from "@/components/admin/forensics/types";

interface DossierHeaderProps {
  dossier: DossierResponse;
  context: DossierContext;
  refreshing: boolean;
}

export function DossierHeader({ dossier, context, refreshing }: DossierHeaderProps) {
  const { identity } = dossier;
  const risk = strongestAltConfidence(dossier.linkedAccounts);
  const flagCount = activeFlagCount(dossier.flags);
  const accent = identity.ban.isBanned ? "#f87171" : confidenceHex(risk);
  const activeSuspicious = dossier.flags.suspiciousCharacters.filter(
    (c) => c.pool === "active" && !c.dismissed
  );

  return (
    <header className="relative overflow-hidden rounded-xl border border-card-border bg-card p-5 shadow-panel">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(120% 140% at 0% 0%, ${accent}14, transparent 55%)`,
        }}
      />
      <div className="relative flex flex-wrap items-center gap-6">
        <ConfidenceMeter value={risk} size="lg" caption="alt risk" />

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className={OVERLINE_CLS}>Account dossier</div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="max-w-full truncate text-xl font-semibold tracking-tight">
              {identity.username}
            </h2>
            {identity.displayName && identity.displayName !== identity.username && (
              <span className="truncate text-sm text-muted">“{identity.displayName}”</span>
            )}
            <span className="rounded-md border border-card-border/70 bg-card-elevated/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
              {identity.role}
            </span>
            {identity.ban.isBanned && (
              <span
                className="rounded-md border border-red-400/25 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-400"
                title={
                  identity.ban.banReason
                    ? `${identity.ban.banReason}${identity.ban.bannedAt ? ` — ${formatDateTime(identity.ban.bannedAt)}` : ""}`
                    : undefined
                }
              >
                Banned
              </span>
            )}
            {context === "moderator" && (
              <span
                className="rounded-md border border-blue-400/25 bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-400"
                title="Moderator view: raw IPs, fingerprints, device keys, and admin-category audit rows are admin-only."
              >
                Moderator view
              </span>
            )}
          </div>
          <p className="text-sm text-muted">
            Created {formatDateTime(identity.createdAt)}
            {identity.lastLogin && <> · last login {formatRelative(identity.lastLogin)}</>}
            {identity.lastDevice && <> · {identity.lastDevice}</>}
            {refreshing && <span className="ml-1 text-xs">Refreshing…</span>}
          </p>

          {/* Vital signs. */}
          <div className="flex flex-wrap gap-x-5 gap-y-1 pt-1">
            <Vital
              label="Linked accounts"
              value={dossier.linkedAccounts.links.length}
              alarming={dossier.linkedAccounts.links.length > 0}
            />
            <Vital
              label="Rings"
              value={dossier.linkedAccounts.clusters.length}
              alarming={dossier.linkedAccounts.clusters.length > 0}
            />
            <Vital label="Suspicious flags" value={flagCount} alarming={flagCount > 0} />
            <div className="flex items-baseline gap-1.5">
              <span
                className={`text-sm font-bold tabular-nums ${
                  dossier.money.totals.net >= 0 ? "text-green-400" : "text-red-400"
                }`}
              >
                {dossier.money.totals.net >= 0 ? "+" : "-"}
                {formatCompactAmount(Math.abs(dossier.money.totals.net))}
              </span>
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
                Net money
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Active suspicious-character chips. */}
      {activeSuspicious.length > 0 && (
        <div className="relative mt-3.5 flex flex-wrap gap-1.5 border-t border-card-border/60 pt-3">
          {activeSuspicious.map((c) => (
            <span
              key={c.characterId}
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium ${SEVERITY_BADGE[c.highestSeverity]}`}
              title={c.flags.map((f) => f.detail).join("\n")}
            >
              <span aria-hidden>⚑</span>
              <span className="max-w-[160px] truncate">{c.characterName}</span>
              <span className="tabular-nums opacity-80">
                {c.flagCount} · {c.highestSeverity}
              </span>
            </span>
          ))}
        </div>
      )}
    </header>
  );
}

function Vital({ label, value, alarming }: { label: string; value: number; alarming: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        className={`text-sm font-bold tabular-nums ${alarming ? "text-amber-400" : "text-foreground/85"}`}
      >
        {value}
      </span>
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted">{label}</span>
    </div>
  );
}

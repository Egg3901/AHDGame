import type { Db } from "mongodb";
import { isLedgerShadowEnabled } from "@/lib/ledger/featureFlag";
import {
  LEDGER_RECONCILIATIONS_COLLECTION,
  loadLatestReconciliation,
} from "@/lib/ledger/reconcile";
import type { LedgerReconciliation, ReconcileReport, ReconcileStatus } from "@/lib/ledger/types";

/**
 * Watchtower / daily-report section for the shadow ledger.
 *
 * The ops-dashboard Observatory/Watchtower cron renders this shape as one
 * green/amber/red section (see docs/plans/2026-07-05-shadow-ledger-plan.md §2.4);
 * it is served by GET /api/admin/ledger/reconciliation. The persisted
 * `ledgerReconciliations` docs drive trending.
 */
export interface LedgerWatchtowerSection {
  title: string;
  status: ReconcileStatus;
  enabled: boolean;
  headline: string;
  latestTurn: number | null;
  checks: { name: string; status: ReconcileStatus; detail: string }[];
  /** Phase 3 backlog: unattributed emit sites ranked by anchor value. */
  topUnattributed: { txType: string; emitSite: string; anchorAmount: number }[];
  generatedAt: string | null;
}

const STATUS_ICON: Record<ReconcileStatus, string> = { green: "🟢", amber: "🟡", red: "🔴" };

export function buildWatchtowerSection(
  report: ReconcileReport | null,
  opts: { enabled: boolean } = { enabled: true }
): LedgerWatchtowerSection {
  if (!report) {
    return {
      title: "Shadow Ledger",
      status: opts.enabled ? "amber" : "green",
      enabled: opts.enabled,
      headline: opts.enabled
        ? "No reconciliation has run yet."
        : "Shadow ledger is disabled (ledgerShadow off).",
      latestTurn: null,
      checks: [],
      topUnattributed: [],
      generatedAt: null,
    };
  }

  const tb = report.trialBalance;
  const sf = report.stockVsFlow;
  const ms = report.moneySupply;
  const driftLine = ms.findings
    .map((f) => `${f.currencyCode} net ${f.netDrift.toFixed(2)}₳`)
    .join(", ");

  return {
    title: "Shadow Ledger",
    status: report.status,
    enabled: opts.enabled,
    headline: `Turn ${report.turn}: ${report.entriesChecked} entries checked — ${STATUS_ICON[report.status]} ${report.status.toUpperCase()}`,
    latestTurn: report.turn,
    checks: [
      {
        name: "Trial balance (per-entry conservation)",
        status: tb.status,
        detail:
          tb.unbalancedCount === 0
            ? "All entries balanced."
            : `${tb.unbalancedCount} unbalanced entr${tb.unbalancedCount === 1 ? "y" : "ies"} — CRITICAL.`,
      },
      {
        name: "Stock vs flow (balance delta vs ledger)",
        status: sf.status,
        detail: sf.skipped
          ? "Skipped (reset/reseed epoch or first shadow turn)."
          : `${sf.divergentCount} divergent account(s).`,
      },
      {
        name: "Money supply",
        status: ms.status,
        detail: driftLine || "No mint/sink activity.",
      },
    ],
    topUnattributed: report.unattributed.slice(0, 20),
    generatedAt: report.generatedAt.toISOString(),
  };
}

export function formatReconciliationMarkdown(report: ReconcileReport | null): string {
  const section = buildWatchtowerSection(report);
  const lines: string[] = [];
  lines.push(`## ${STATUS_ICON[section.status]} ${section.title} — ${section.headline}`);
  lines.push("");
  for (const check of section.checks) {
    lines.push(`- ${STATUS_ICON[check.status]} **${check.name}** — ${check.detail}`);
  }
  if (section.topUnattributed.length > 0) {
    lines.push("");
    lines.push("### Phase 3 backlog — top unattributed emit sites (by ₳)");
    lines.push("");
    lines.push("| ₳ (abs) | txType | emitSite |");
    lines.push("| ---: | --- | --- |");
    for (const u of section.topUnattributed) {
      lines.push(
        `| ${Math.round(u.anchorAmount).toLocaleString()} | ${u.txType} | ${u.emitSite} |`
      );
    }
  }
  return lines.join("\n");
}

/** Load the latest reconciliation and render the Watchtower section. */
export async function loadLatestWatchtowerSection(db: Db): Promise<LedgerWatchtowerSection> {
  const latest = await loadLatestReconciliation(db);
  const enabled = await isLedgerShadowEnabled();
  return buildWatchtowerSection(stripId(latest), { enabled });
}

function stripId(doc: LedgerReconciliation | null): ReconcileReport | null {
  if (!doc) return null;
  const { _id: _drop, ...rest } = doc;
  void _drop;
  return rest;
}

export { LEDGER_RECONCILIATIONS_COLLECTION };

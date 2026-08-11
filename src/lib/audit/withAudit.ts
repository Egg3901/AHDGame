import { recordAudit } from "@/lib/audit/recordAudit";
import type {
  ActionAuditCategory,
  ActionAuditCounterparty,
  ActionAuditDelta,
  ActionAuditInput,
  ActionAuditRefs,
  ActionAuditSource,
  ActionAuditSubject,
} from "@/lib/db/types/actionAuditLog";
import type { CurrencyCode } from "@/lib/constants/currencies";

/**
 * Thin wrapper for command modules that DON'T flow through a central
 * dispatcher (`executeAction.ts` for AP actions, `logEconomicAction` for
 * corp-economic actions) — party membership/donate/whip, corp lifecycle
 * (found/dissolve/dividends/capital), nationalization/privatization.
 *
 * Records one `recordAudit` envelope around `fn`: `outcome:"ok"` on a normal
 * return, `outcome:"error"` (+ `reason`) on throw — then rethrows so the
 * caller's own error handling is unaffected. Fire-and-forget/never-throws is
 * `recordAudit`'s own contract; `withAudit` adds nothing that could make a
 * command fail because it was audited.
 */
export interface WithAuditEnvelope {
  subject?: ActionAuditSubject;
  counterparty?: ActionAuditCounterparty;
  refs?: ActionAuditRefs;
  amount?: number;
  currencyCode?: CurrencyCode;
  anchorAmount?: number;
  delta?: ActionAuditDelta[];
  meta?: Record<string, unknown>;
  source?: ActionAuditSource;
  actor?: ActionAuditInput["actor"];
}

const DEFAULT_SUBJECT: ActionAuditSubject = { type: "unknown" };

function buildEnvelope(category: ActionAuditCategory, envelope?: WithAuditEnvelope) {
  return {
    source: envelope?.source ?? ("api" as const),
    category,
    subject: envelope?.subject ?? DEFAULT_SUBJECT,
    counterparty: envelope?.counterparty,
    refs: envelope?.refs,
    amount: envelope?.amount,
    currencyCode: envelope?.currencyCode,
    anchorAmount: envelope?.anchorAmount,
    delta: envelope?.delta,
    meta: envelope?.meta,
    actor: envelope?.actor,
  };
}

/**
 * Run `fn`, recording one audit envelope for it. `envelope` may be a static
 * object or a function of the resolved result — the latter lets callers pull
 * `subject`/`refs`/`amount` out of whatever `fn` returns (e.g. a created
 * corporation's `_id`) without a second round of bookkeeping.
 */
export async function withAudit<T>(
  action: string,
  category: ActionAuditCategory,
  fn: () => Promise<T>,
  envelope?: WithAuditEnvelope | ((result: T) => WithAuditEnvelope | undefined)
): Promise<T> {
  try {
    const result = await fn();
    const resolvedEnvelope = typeof envelope === "function" ? envelope(result) : envelope;
    recordAudit({
      action,
      ...buildEnvelope(category, resolvedEnvelope),
      outcome: "ok",
    });
    return result;
  } catch (err) {
    recordAudit({
      action,
      ...buildEnvelope(category, typeof envelope === "function" ? undefined : envelope),
      outcome: "error",
      reason: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

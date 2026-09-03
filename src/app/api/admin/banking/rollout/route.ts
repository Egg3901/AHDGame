import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { createAdminLog } from "@/lib/adminLog";
import { getCurrentTurn } from "@/lib/currentTurn";
import type { GameConfig } from "@/lib/db/types";
import { FOREX_ACTIVE_CURRENCIES } from "@/lib/constants/currencies";
import { loadBankingPolicy } from "@/lib/banking/policy";
import { buildBankingHealth, type BankingHealthReport } from "@/lib/banking/health";
import {
  decideRolloutChange,
  rollbackConditions,
  rolloutStateOf,
  type RolloutChange,
  type RolloutEvidence,
} from "@/lib/banking/rules/rollout";

const changeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("mode"), mode: z.enum(["off", "shadow", "authoritative"]) }),
  z.object({ kind: z.literal("add_read_currency"), currency: z.string().min(3).max(3) }),
  z.object({ kind: z.literal("remove_read_currency"), currency: z.string().min(3).max(3) }),
]);

function evidenceFrom(health: BankingHealthReport, currentTurn: number): RolloutEvidence {
  return {
    gateOk: health.gate.ok,
    gateReasons: health.gate.reasons,
    currentTurn,
    comparison: health.savingsAccounts.comparison
      ? {
          turn: health.savingsAccounts.comparison.turn,
          currencies: health.savingsAccounts.comparison.currencies.map((c) => ({
            currency: c.currency,
            legacyOwnerTotal: c.legacyOwnerTotal,
            accountOwnerTotal: c.accountOwnerTotal,
            rowDiscrepancies: c.rowDiscrepancies,
            discrepancies: c.discrepancies,
          })),
        }
      : null,
  };
}

async function snapshot(db: Awaited<ReturnType<typeof getDb>>) {
  const [policy, health, currentTurn] = await Promise.all([
    loadBankingPolicy(db),
    buildBankingHealth(db),
    getCurrentTurn(db),
  ]);
  const state = rolloutStateOf(policy);
  const evidence = evidenceFrom(health, currentTurn);
  // Every change the panel could offer, decided now, so the buttons say why
  // they are disabled instead of failing on click.
  const candidates: RolloutChange[] = [
    { kind: "mode", mode: "off" },
    { kind: "mode", mode: "shadow" },
    { kind: "mode", mode: "authoritative" },
    ...FOREX_ACTIVE_CURRENCIES.map((currency): RolloutChange =>
      state.readCurrencies.includes(currency)
        ? { kind: "remove_read_currency", currency }
        : { kind: "add_read_currency", currency }
    ),
  ];
  return {
    privateBankingEnabled: policy.privateBanking,
    state,
    currentTurn,
    gate: health.gate,
    comparison: evidence.comparison,
    rollback: rollbackConditions(state, evidence),
    decisions: candidates.map((change) => ({
      change,
      ...decideRolloutChange(state, change, evidence),
    })),
  };
}

// GET /api/admin/banking/rollout - the savings rollout: mode, read cohort, the
// gate and comparison it is judged against, every change decided in advance,
// and the rollback conditions currently raised.
// Auth: requireAdmin only. Works when privateBankingEnabled is false.
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const db = await getDb();
    return NextResponse.json(await snapshot(db));
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/admin/banking/rollout - apply one rollout change. Widening is
// refused with the rules' reasons; narrowing always applies.
// Auth: requireAdmin only.
// Errors: 400 (invalid body), 403, 409 (refused by the rules)
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const parsed = await parseJsonBody(request, changeSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const change = parsed.data as RolloutChange;
    if (
      (change.kind === "add_read_currency" || change.kind === "remove_read_currency") &&
      !(FOREX_ACTIVE_CURRENCIES as string[]).includes(change.currency)
    ) {
      return NextResponse.json({ error: "Unknown currency." }, { status: 400 });
    }

    const db = await getDb();
    const before = await snapshot(db);
    const decision = decideRolloutChange(
      before.state,
      change,
      evidenceFrom(await buildBankingHealth(db), before.currentTurn)
    );
    if (!decision.allowed) {
      return NextResponse.json(
        { error: "Refused by the rollout rules.", reasons: decision.reasons },
        { status: 409 }
      );
    }
    if (decision.direction !== "none") {
      await db.collection<GameConfig>("gameConfig").updateOne(
        { _id: "default" },
        {
          $set: {
            savingsAccountsMode: decision.next.mode,
            savingsAccountsReadCurrencies: decision.next.readCurrencies,
          },
        },
        { upsert: true }
      );
      await createAdminLog({
        category: "system",
        action:
          decision.direction === "widen" ? "savings_rollout_widened" : "savings_rollout_narrowed",
        username: auth.admin.username,
        adminUsername: auth.admin.username,
        details: `Savings rollout: ${describeChange(change)}. Now ${decision.next.mode}, read cohort [${decision.next.readCurrencies.join(", ")}].`,
      });
    }
    return NextResponse.json({ success: true, ...(await snapshot(db)) });
  } catch (error) {
    return handleRouteError(error);
  }
}

function describeChange(change: RolloutChange): string {
  switch (change.kind) {
    case "mode":
      return `mode set to ${change.mode}`;
    case "add_read_currency":
      return `${change.currency} added to the read cohort`;
    case "remove_read_currency":
      return `${change.currency} removed from the read cohort`;
  }
}

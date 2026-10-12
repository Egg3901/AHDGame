// Compensation: paying corporations what a bug cost them, with a receipt.
//
// Why this exists: on 2026-10-12, 28 owner-approved credits after the turn 134
// governor cliff were written as direct balance edits (an ad-hoc `set` of
// liquidCapital and a script). The money landed, but no financialTxLog row
// and no shadow-ledger entry recorded it, so the corporations' histories show
// cash appearing from nowhere and the ledger cannot attribute the mint.
//
// A compensation spec is compiled into a real `Defect`, like an ad-hoc spec,
// so it runs down the same path: dry run, confirm token, turn lock, row cap,
// snapshot, audit row, rollback. Unlike an ad-hoc `set` it knows what it is
// doing to money: it increments the balance by an exact amount, marks the
// corporation so a repeat run pays nobody twice, reports the real moneyDelta,
// and emits one `restitution_credit` receipt per credit.
//
// `receipt-only` mode exists for money that already moved outside the heal
// engine: it writes the missing receipt, stamped to when and in which ledger
// turn the money actually moved, without touching the balance again.

import { createHash } from "crypto";
import { ObjectId, type Db } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import type { ExchangeRate } from "@/lib/db/types";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";
import { emitTxBulk, loadTxThresholds } from "@/lib/financialTxLog/emit";
import { runWithLedgerTurn } from "@/lib/ledger/ledgerTurn";
import type {
  CompensationSpec,
  Defect,
  DetectResult,
  HealContext,
  HealPlan,
  HealResult,
  VerifyResult,
} from "./types";

export interface CompensationProblem {
  field: string;
  detail: string;
}

const HEX_ID = /^[0-9a-f]{24}$/;

/** Every problem at once, so an operator fixes the spec in one pass. */
export function validateCompensationSpec(
  spec: CompensationSpec,
  now = new Date()
): CompensationProblem[] {
  const problems: CompensationProblem[] = [];
  if (!spec.description || spec.description.trim().length < 10) {
    problems.push({
      field: "description",
      detail:
        "say who is owed what and why, in a sentence. It goes into healRuns and every receipt.",
    });
  }
  if (spec.mode !== "credit" && spec.mode !== "receipt-only") {
    problems.push({ field: "mode", detail: 'choose "credit" or "receipt-only"' });
  }
  const credits = Array.isArray(spec.credits) ? spec.credits : [];
  if (credits.length === 0)
    problems.push({ field: "credits", detail: "at least one credit is required" });
  const seen = new Set<string>();
  credits.forEach((credit, index) => {
    const at = `credits[${index}]`;
    if (!HEX_ID.test(String(credit?.corporationId ?? ""))) {
      problems.push({
        field: `${at}.corporationId`,
        detail: "a corporations._id as 24 hex characters",
      });
    } else if (seen.has(credit.corporationId)) {
      problems.push({
        field: `${at}.corporationId`,
        detail: "listed twice; one credit per corporation",
      });
    } else {
      seen.add(credit.corporationId);
    }
    if (!(
      typeof credit?.amountLocal === "number" &&
      Number.isFinite(credit.amountLocal) &&
      credit.amountLocal > 0
    )) {
      problems.push({
        field: `${at}.amountLocal`,
        detail: "a positive amount in the corporation's own currency. Debits are not compensation.",
      });
    }
  });
  if (!Number.isInteger(spec.expectedMax) || spec.expectedMax <= 0) {
    problems.push({ field: "expectedMax", detail: "required, a positive integer" });
  } else if (credits.length > spec.expectedMax) {
    problems.push({
      field: "expectedMax",
      detail: `${credits.length} credits exceed expectedMax ${spec.expectedMax}`,
    });
  }
  if (spec.mode === "receipt-only") {
    const moved = Date.parse(spec.movedAt ?? "");
    if (!Number.isFinite(moved) || moved > now.getTime()) {
      problems.push({
        field: "movedAt",
        detail: "receipt-only needs the ISO time the money actually moved",
      });
    }
    if (!Number.isInteger(spec.ledgerTurn) || (spec.ledgerTurn ?? 0) <= 0) {
      problems.push({
        field: "ledgerTurn",
        detail:
          "receipt-only needs the ledger turn the money moved in: the game clock at movedAt, plus one",
      });
    }
  } else if (spec.movedAt !== undefined || spec.ledgerTurn !== undefined) {
    problems.push({
      field: "movedAt",
      detail: "credit mode moves money now; movedAt and ledgerTurn are receipt-only fields",
    });
  }
  return problems;
}

/** Stable id: the same credits in the same mode always group together. */
export function compensationId(spec: CompensationSpec): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({ m: spec.mode, c: spec.credits.map((c) => [c.corporationId, c.amountLocal]) })
    )
    .digest("hex")
    .slice(0, 10);
  return `COMP-${spec.ticket ? `${String(spec.ticket).replace(/[^\w-]/g, "")}-` : ""}${digest}`;
}

interface CorporationDoc {
  _id: ObjectId;
  name?: string;
  countryId?: string;
  liquidCurrencyCode?: CurrencyCode | null;
  remediation?: Record<string, unknown>;
}

export interface PlannedCompensation {
  corporationId: string;
  corporationName: string;
  amountLocal: number;
  currencyCode: CurrencyCode;
  /** Local currency per 1 anchor at plan time; 1 for pre-forex corporations. */
  fxRate: number;
  amountAnchor: number;
  basis?: string;
}

interface Payload {
  credits: PlannedCompensation[];
  totalAnchor: number;
  missing: string[];
}

export function compileCompensationDefect(spec: CompensationSpec): Defect {
  const problems = validateCompensationSpec(spec);
  if (problems.length > 0) {
    throw new Error(
      `[remediation] compensation spec rejected:\n${problems.map((p) => `  ${p.field}: ${p.detail}`).join("\n")}`
    );
  }
  const id = compensationId(spec);
  const markerPath = `remediation.${id}`;
  // Corporation ids are ObjectIds; the string form is also matched, as the
  // ad-hoc path does, so a document keyed by its hex string is not missed.
  const idCandidates = (id: string) => [new ObjectId(id), id];
  const ids = spec.credits.flatMap((c) => idCandidates(c.corporationId));

  async function load(db: Db) {
    const [docs, rates] = await Promise.all([
      db
        .collection<CorporationDoc>("corporations")
        .find({ _id: { $in: ids } } as never, {
          projection: { name: 1, countryId: 1, liquidCurrencyCode: 1, remediation: 1 },
        })
        .toArray(),
      db.collection<ExchangeRate>("exchangeRates").find({}).toArray(),
    ]);
    return {
      byId: new Map(docs.map((doc) => [String(doc._id), doc])),
      rates: new Map(rates.map((rate) => [String(rate.currencyCode), rate.rate])),
    };
  }

  async function buildPlanned(db: Db): Promise<Payload> {
    const { byId, rates } = await load(db);
    const credits: PlannedCompensation[] = [];
    const missing: string[] = [];
    for (const credit of spec.credits) {
      const doc = byId.get(credit.corporationId);
      if (!doc) {
        missing.push(credit.corporationId);
        continue;
      }
      if (doc.remediation?.[id]) continue;
      const liquid = doc.liquidCurrencyCode ?? null;
      const currencyCode = liquid ?? getHomeCurrency({ countryId: doc.countryId ?? "US" });
      const fxRate = liquid ? (rates.get(currencyCode) ?? 0) : 1;
      if (!Number.isFinite(fxRate) || fxRate <= 0) {
        missing.push(credit.corporationId);
        continue;
      }
      credits.push({
        corporationId: credit.corporationId,
        corporationName: doc.name ?? "",
        amountLocal: credit.amountLocal,
        currencyCode,
        fxRate,
        amountAnchor: credit.amountLocal / fxRate,
        basis: credit.basis,
      });
    }
    return { credits, totalAnchor: credits.reduce((sum, c) => sum + c.amountAnchor, 0), missing };
  }

  const detect = async (db: Db): Promise<DetectResult> => {
    const { credits, missing } = await buildPlanned(db);
    return {
      affected: credits.length,
      sample: credits.slice(0, 10),
      notes: [
        `${credits.length} of ${spec.credits.length} corporations still owed ${spec.mode === "credit" ? "a credit" : "a receipt"}`,
        ...(missing.length
          ? [
              `${missing.length} listed corporations are gone or have no exchange rate: ${missing.join(", ")}`,
            ]
          : []),
        spec.description,
      ],
    };
  };

  const plan = async (db: Db): Promise<HealPlan> => {
    const payload = await buildPlanned(db);
    const credit = spec.mode === "credit";
    return {
      affected: payload.credits.length,
      touched: [{ collection: "corporations", ids: payload.credits.map((c) => c.corporationId) }],
      // A receipt-only run records money that already moved, so it creates none.
      moneyDelta: credit ? payload.totalAnchor : 0,
      summary: `COMPENSATION (${spec.mode}): ${credit ? "credit" : "record receipts for"} ${Math.round(payload.totalAnchor).toLocaleString("en-US")} anchor across ${payload.credits.length} corporations: ${spec.description}`,
      notes: [
        credit
          ? "increments liquidCapital by each exact amount and emits a restitution_credit receipt per corporation"
          : `balances are NOT changed: the money moved at ${spec.movedAt} (ledger turn ${spec.ledgerTurn}); this writes the receipts that were never emitted`,
        "a marker on each corporation makes a repeat run a no-op",
        ...(spec.ticket ? [`ticket: ${spec.ticket}`] : []),
        ...(payload.missing.length
          ? [`SKIPPED (gone or no exchange rate): ${payload.missing.join(", ")}`]
          : []),
      ],
      payload,
    };
  };

  const apply = async (db: Db, healPlan: HealPlan, ctx: HealContext): Promise<HealResult> => {
    const payload = healPlan.payload as Payload | undefined;
    const credits = payload?.credits ?? [];
    if (credits.length === 0)
      return { documentsScanned: 0, documentsUpdated: 0, notes: ["nothing to compensate"] };
    const creditMode = spec.mode === "credit";
    const applied: PlannedCompensation[] = [];
    for (const c of credits) {
      // Marker and increment in ONE update, under a filter demanding the
      // marker's absence, so a concurrent or repeated run pays nobody twice.
      const res = await db
        .collection("corporations")
        .updateOne(
          {
            _id: { $in: idCandidates(c.corporationId) },
            [markerPath]: { $exists: false },
          } as never,
          {
            ...(creditMode ? { $inc: { liquidCapital: c.amountLocal } } : {}),
            $set: {
              [markerPath]: {
                mode: spec.mode,
                ticket: spec.ticket ?? null,
                amountLocal: c.amountLocal,
                amountAnchor: c.amountAnchor,
                currencyCode: c.currencyCode,
                fxRate: c.fxRate,
                recordedAt: ctx.now,
                ...(creditMode ? {} : { movedAt: spec.movedAt, ledgerTurn: spec.ledgerTurn }),
                runId: ctx.runId ?? null,
              },
              updatedAt: ctx.now,
            },
          }
        );
      if (res.modifiedCount === 1) applied.push(c);
    }

    if (applied.length > 0) {
      const thresholds = await loadTxThresholds(db);
      const state = await db
        .collection<{ _id: string; currentTurn?: number }>("gameState")
        .findOne({ _id: "current" }, { projection: { currentTurn: 1 } });
      const createdAt = creditMode ? ctx.now : new Date(spec.movedAt as string);
      // Rows carry the clock as their display turn; the ledger entry belongs
      // to the turn whose closing snapshot saw the money move.
      const displayTurn = creditMode ? (state?.currentTurn ?? 0) : (spec.ledgerTurn as number) - 1;
      const emit = () =>
        emitTxBulk(
          db,
          applied.map((c) => ({
            type: "restitution_credit" as const,
            turn: displayTurn,
            createdAt,
            subjectType: "corporation" as const,
            subjectId: new ObjectId(c.corporationId),
            subjectName: c.corporationName,
            amount: c.amountLocal,
            currencyCode: c.currencyCode,
            anchorAmount: c.amountAnchor,
            meta: {
              compensationId: id,
              mode: spec.mode,
              ticket: spec.ticket ?? null,
              runId: ctx.runId ?? null,
              fxRate: c.fxRate,
              description: spec.description.slice(0, 300),
              ...(c.basis ? { basis: c.basis.slice(0, 300) } : {}),
            },
          })),
          thresholds
        );
      await (creditMode ? emit() : runWithLedgerTurn(spec.ledgerTurn as number, emit));
    }

    // emitTxBulk mints its own ids: read them back so a rollback deletes them.
    const receipts = ctx.runId
      ? await db
          .collection<FinancialTxLogEntry>("financialTxLog")
          .find({ type: "restitution_credit", "meta.runId": ctx.runId }, { projection: { _id: 1 } })
          .toArray()
      : [];
    return {
      documentsScanned: credits.length,
      documentsUpdated: applied.length,
      insertedIds: receipts.length
        ? [{ collection: "financialTxLog", ids: receipts.map((r) => r._id.toString()) }]
        : undefined,
      notes: [
        `${creditMode ? "credited" : "recorded"} ${applied.length} of ${credits.length} corporations`,
        `emitted ${receipts.length} restitution_credit receipts`,
      ],
    };
  };

  const verify = async (db: Db): Promise<VerifyResult> => {
    const { byId } = await load(db);
    const marked = spec.credits.filter((c) => byId.get(c.corporationId)?.remediation?.[id]);
    const receipts = await db
      .collection("financialTxLog")
      .countDocuments({ type: "restitution_credit", "meta.compensationId": id });
    const unmarked = spec.credits.filter((c) => byId.has(c.corporationId)).length - marked.length;
    return {
      ok: unmarked === 0 && receipts >= marked.length,
      remaining: unmarked + Math.max(0, marked.length - receipts),
      notes: [
        `${marked.length} of ${spec.credits.length} corporations carry the ${id} marker`,
        `${receipts} restitution_credit receipts carry compensationId ${id}`,
        ...(receipts < marked.length
          ? [
              "RECEIPTS MISSING: a marked corporation has no receipt; inspect financialTxLog before re-running",
            ]
          : []),
      ],
    };
  };

  return {
    id,
    title: `Compensation: ${spec.description}`,
    severity: "P2",
    seedFix: {
      status: "not-needed",
      note: "compensation repays players for a runtime defect; the defect's own fix carries any seed question",
    },
    envs: ["dev", "sandbox", "prod"],
    idempotent: true,
    // Credits deliberately create money: an owner-approved repayment. A
    // receipt-only run moves none.
    mintsMoney: spec.mode === "credit",
    guards: ["turn-lock-free", `max-affected:${spec.expectedMax}`],
    detect,
    plan,
    apply,
    verify,
  };
}

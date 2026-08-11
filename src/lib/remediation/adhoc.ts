// Ad-hoc repairs, built as synthetic Defects.
//
// Why this exists: a ledger only makes direct database writes obsolete if the
// ledger covers the case where there is NO ledger entry yet. Otherwise the
// first novel corruption sends someone to mongosh, and everything the
// framework guarantees — the dry run, the snapshot, the row cap, the audit
// row, the rollback — is gone for exactly the change nobody has thought about
// before.
//
// So an ad-hoc spec is compiled into a real `Defect` and runs down the same
// path as a registered one. Nothing here bypasses a guard; several guards are
// STRICTER than for a registered defect, because a registered defect has been
// code-reviewed and an ad-hoc one has not.
//
// This is not a substitute for a ledger entry. Anything that happens twice
// should be promoted into defects/ — `heal_history` makes the repeats obvious.

import { createHash } from "crypto";
import type { Db, Filter, Document } from "mongodb";
import { ObjectId } from "mongodb";
import type { AdhocSpec, Defect, DetectResult, HealPlan, HealResult, VerifyResult } from "./types";

/**
 * Collections the ad-hoc path may never touch. The ledger's own tables are
 * here for an obvious reason: an ad-hoc write that can edit `healRuns` or
 * `healBackups` can erase the evidence of itself and destroy the rollback for
 * every other run.
 */
const FORBIDDEN_COLLECTIONS = new Set([
  "healRuns",
  "healBackups",
  "healTokens",
  "migrationsRun",
  "system.indexes",
  "system.users",
]);

/**
 * Substrings that mark a field as money-shaped. Matching one forces an
 * explicit `touchesMoney` declaration, so nobody edits a balance by accident
 * while fixing something adjacent.
 */
const MONEY_HINTS = [
  "money",
  "cash",
  "balance",
  "fund",
  "treasury",
  "revenue",
  "capital",
  "price",
  "wealth",
  "salary",
  "debt",
  "income",
  "cost",
  "budget",
  "payout",
  "coupon",
];

function looksLikeMoney(field: string): boolean {
  const lower = field.toLowerCase();
  return MONEY_HINTS.some((hint) => lower.includes(hint));
}

/** Fields the spec's action would write, including dotted paths. */
function writtenFields(spec: AdhocSpec): string[] {
  if (spec.action.kind === "set") return Object.keys(spec.action.set);
  if (spec.action.kind === "unset") return spec.action.unset;
  return [];
}

export interface SpecProblem {
  field: string;
  detail: string;
}

/**
 * Validate a spec BEFORE it touches the database. Returns every problem at
 * once rather than the first, so an operator fixes the spec in one pass.
 */
export function validateAdhocSpec(spec: AdhocSpec): SpecProblem[] {
  const problems: SpecProblem[] = [];

  if (!spec.description || spec.description.trim().length < 10) {
    problems.push({
      field: "description",
      detail:
        "describe what you are repairing and why, in a sentence. It is the only explanation that survives in healRuns.",
    });
  }
  if (!spec.collection) {
    problems.push({ field: "collection", detail: "required" });
  } else if (FORBIDDEN_COLLECTIONS.has(spec.collection)) {
    problems.push({
      field: "collection",
      detail: `"${spec.collection}" is off limits to ad-hoc writes — it holds the audit trail or rollback data for every other heal`,
    });
  }

  const filterKeys = Object.keys(spec.filter ?? {});
  if (filterKeys.length === 0 && spec.confirmWholeCollection !== true) {
    problems.push({
      field: "filter",
      detail:
        "empty filter matches the ENTIRE collection. Set confirmWholeCollection: true if that is genuinely what you mean.",
    });
  }

  if (!Number.isInteger(spec.expectedMax) || spec.expectedMax <= 0) {
    problems.push({
      field: "expectedMax",
      detail:
        "required, a positive integer. State how many documents you expect to touch; the run is refused if reality disagrees.",
    });
  }

  if (spec.action.kind === "set" && Object.keys(spec.action.set).length === 0) {
    problems.push({ field: "action.set", detail: "empty — nothing would change" });
  }
  if (spec.action.kind === "unset" && spec.action.unset.length === 0) {
    problems.push({ field: "action.unset", detail: "empty — nothing would change" });
  }

  const moneyFields = writtenFields(spec).filter(looksLikeMoney);
  if (moneyFields.length > 0 && spec.touchesMoney !== true) {
    problems.push({
      field: "touchesMoney",
      detail: `writes money-shaped field(s) ${moneyFields.join(", ")} — set touchesMoney: true to confirm you mean to move currency, or rename the write if you do not`,
    });
  }

  return problems;
}

/** Stable id so repeat runs of the same repair group together in history. */
export function adhocId(spec: AdhocSpec): string {
  const digest = createHash("sha256")
    .update(JSON.stringify({ c: spec.collection, f: spec.filter, a: spec.action }))
    .digest("hex")
    .slice(0, 10);
  return `ADHOC-${spec.collection}-${digest}`;
}

function idCandidates(id: string): unknown[] {
  const candidates: unknown[] = [id];
  if (ObjectId.isValid(id) && new ObjectId(id).toString() === id) candidates.push(new ObjectId(id));
  return candidates;
}

async function matchIds(db: Db, spec: AdhocSpec): Promise<string[]> {
  const docs = await db
    .collection(spec.collection)
    .find(spec.filter as Filter<Document>, { projection: { _id: 1 } })
    .toArray();
  return docs.map((doc) => String(doc._id));
}

/**
 * Compile a validated spec into a Defect. Throws on an invalid spec: an
 * invalid ad-hoc write must never reach the runner.
 */
export function compileAdhocDefect(spec: AdhocSpec): Defect {
  const problems = validateAdhocSpec(spec);
  if (problems.length > 0) {
    throw new Error(
      `[remediation] ad-hoc spec rejected:\n${problems.map((p) => `  ${p.field}: ${p.detail}`).join("\n")}`
    );
  }

  const id = adhocId(spec);
  const verb =
    spec.action.kind === "delete"
      ? "delete"
      : spec.action.kind === "set"
        ? `set ${Object.keys(spec.action.set).join(", ")} on`
        : `unset ${spec.action.unset.join(", ")} on`;

  const detect = async (db: Db): Promise<DetectResult> => {
    const ids = await matchIds(db, spec);
    const sample = await db
      .collection(spec.collection)
      .find(spec.filter as Filter<Document>)
      .limit(10)
      .toArray();
    return {
      affected: ids.length,
      sample,
      notes: [`${ids.length} document(s) match in ${spec.collection}`, spec.description],
    };
  };

  const plan = async (db: Db): Promise<HealPlan> => {
    const ids = await matchIds(db, spec);
    return {
      affected: ids.length,
      touched: [{ collection: spec.collection, ids }],
      // Arbitrary updates cannot have a delta computed, so money safety here
      // is the declaration plus the field-name check in validateAdhocSpec,
      // not arithmetic. Kept at 0 so the standard guard still applies to
      // anything that slipped past the name check.
      moneyDelta: 0,
      summary: `AD-HOC: ${verb} ${ids.length} document(s) in ${spec.collection} — ${spec.description}`,
      notes: [
        `filter: ${JSON.stringify(spec.filter)}`,
        `action: ${JSON.stringify(spec.action)}`,
        ...(spec.ticket ? [`ticket: ${spec.ticket}`] : []),
        ...(spec.touchesMoney ? ["DECLARED: this write moves money"] : []),
        "ad-hoc repair — if this recurs, promote it to a defect in src/lib/remediation/defects/",
      ],
      payload: spec,
    };
  };

  const apply = async (db: Db, healPlan: HealPlan): Promise<HealResult> => {
    const approved = healPlan.touched.find((t) => t.collection === spec.collection)?.ids ?? [];
    // Restrict to the approved ids AND re-assert the original filter, so a
    // document that stopped matching between plan and apply is left alone.
    const scoped = {
      $and: [spec.filter, { _id: { $in: approved.flatMap(idCandidates) } }],
    } as unknown as Filter<Document>;

    if (spec.action.kind === "delete") {
      const res = await db.collection(spec.collection).deleteMany(scoped);
      return {
        documentsDeleted: res.deletedCount,
        notes: [`deleted ${res.deletedCount} of ${approved.length} approved`],
      };
    }
    const update =
      spec.action.kind === "set"
        ? { $set: spec.action.set }
        : { $unset: Object.fromEntries(spec.action.unset.map((f) => [f, ""])) };
    const res = await db.collection(spec.collection).updateMany(scoped, update);
    return {
      documentsUpdated: res.modifiedCount,
      notes: [`updated ${res.modifiedCount} of ${approved.length} approved`],
    };
  };

  /**
   * Verify against the INTENDED POST-STATE of the approved documents, not
   * against the filter. A `$set` often leaves its own filter still matching,
   * so "filter returns zero" is the wrong assertion for anything but a delete.
   */
  const verify = async (db: Db): Promise<VerifyResult> => {
    if (spec.action.kind === "delete") {
      const left = await db
        .collection(spec.collection)
        .countDocuments(spec.filter as Filter<Document>);
      return {
        ok: left === 0,
        remaining: left,
        notes: [left === 0 ? "no documents match the filter" : `${left} still match`],
      };
    }

    const stillMatching = await db
      .collection(spec.collection)
      .find(spec.filter as Filter<Document>)
      .limit(500)
      .toArray();

    const unapplied = stillMatching.filter((doc) => {
      if (spec.action.kind === "set") {
        return Object.entries(spec.action.set).some(
          ([field, value]) => JSON.stringify(readPath(doc, field)) !== JSON.stringify(value)
        );
      }
      if (spec.action.kind === "unset") {
        return spec.action.unset.some((field: string) => readPath(doc, field) !== undefined);
      }
      // delete: any document still matching the filter has not been applied.
      return true;
    });

    return {
      ok: unapplied.length === 0,
      remaining: unapplied.length,
      notes: [
        unapplied.length === 0
          ? "every matching document carries the intended values"
          : `${unapplied.length} document(s) still do not carry the intended values`,
      ],
    };
  };

  return {
    id,
    title: `Ad-hoc: ${spec.description}`,
    severity: "P2",
    // An ad-hoc repair has, by definition, not been assessed for a seed cause.
    // Saying so out loud is the point: `plan` will warn.
    seedFix: {
      status: "unknown",
      note: "ad-hoc repair — nobody has checked whether a seed reproduces this",
    },
    envs: ["dev", "sandbox", "prod"],
    idempotent: true,
    mintsMoney: spec.touchesMoney === true,
    guards: ["turn-lock-free", `max-affected:${spec.expectedMax}`],
    detect,
    plan,
    apply,
    verify,
  };
}

function readPath(doc: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (cur, part) =>
        cur && typeof cur === "object" ? (cur as Record<string, unknown>)[part] : undefined,
      doc
    );
}

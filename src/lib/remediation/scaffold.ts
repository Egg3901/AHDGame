// Template for a new ledger entry.
//
// This exists because a framework people skip is a framework that does not
// exist. If writing a proper defect costs twenty minutes of boilerplate and an
// updateMany in mongosh costs thirty seconds, the mongosh call wins every time
// and none of the guards ever run. `scaffold` closes that gap.
//
// Built by joining lines rather than as one template literal: the body is
// itself TypeScript containing template literals, and nesting them turns into
// an escaping puzzle for no benefit.

const BACKTICK = "`";

export function scaffoldFor(id: string, collection = "<collection>"): string {
  const t = (inner: string) => BACKTICK + inner + BACKTICK;

  return [
    `// ${id}: <one line describing the corruption>`,
    "//",
    "// Half A (code): <what stops new bad rows being written>",
    "// Half B (this heal): <what repairs the rows already written>",
    "// Half C (seed): <does a seed emit this shape? if so it must be fixed too,",
    "//                 or the next world reset undoes this heal>",
    "",
    'import type { Db } from "mongodb";',
    'import type { Defect, DetectResult, HealPlan, HealResult, VerifyResult } from "../types";',
    "",
    "/** The query that DEFINES the bug. Write this first: if you cannot count",
    " *  the bad rows, you cannot prove the heal worked. */",
    `const BAD_SHAPE = {} as const;`,
    "",
    `const COLLECTION = "${collection}";`,
    "",
    "async function detect(db: Db): Promise<DetectResult> {",
    "  const rows = await db.collection(COLLECTION).find(BAD_SHAPE).limit(1000).toArray();",
    "  return { affected: rows.length, sample: rows.slice(0, 10) };",
    "}",
    "",
    "async function plan(db: Db): Promise<HealPlan> {",
    "  const rows = await db.collection(COLLECTION).find(BAD_SHAPE).toArray();",
    "  return {",
    "    affected: rows.length,",
    "    touched: [{ collection: COLLECTION, ids: rows.map((r) => String(r._id)) }],",
    "    // Non-zero needs mintsMoney on the defect, and a reason.",
    "    moneyDelta: 0,",
    `    summary: ${t("repair ${rows.length} row(s)")},`,
    "  };",
    "}",
    "",
    "async function apply(db: Db, healPlan: HealPlan): Promise<HealResult> {",
    "  const ids = healPlan.touched[0]?.ids ?? [];",
    "  // Re-assert BAD_SHAPE alongside the approved ids: a row that stopped being",
    "  // broken between plan and apply must be left alone.",
    "  const res = await db",
    "    .collection(COLLECTION)",
    "    .updateMany({ ...BAD_SHAPE, _id: { $in: ids } }, { $set: {} });",
    "  return { documentsUpdated: res.modifiedCount };",
    "}",
    "",
    "async function verify(db: Db): Promise<VerifyResult> {",
    "  const remaining = await db.collection(COLLECTION).countDocuments(BAD_SHAPE);",
    `  return { ok: remaining === 0, remaining, notes: [${t("${remaining} remaining")}] };`,
    "}",
    "",
    "export const defect: Defect = {",
    `  id: "${id}",`,
    '  title: "<short title>",',
    '  severity: "P2",',
    "  // Pin requiredCommit once the code half merges, or the code gate cannot",
    "  // check whether the fix is actually live in the env you are healing.",
    '  codeFix: { issue: 0, requiredCommit: "<sha>" },',
    '  // MANDATORY. "unknown" is allowed and warns on every plan — answer it if',
    "  // you can, and record why when the answer is not-needed.",
    '  seedFix: { status: "unknown" },',
    '  envs: ["dev", "sandbox", "prod"],',
    "  idempotent: true,",
    '  guards: ["turn-lock-free", "max-affected:1000"],',
    "  detect,",
    "  plan,",
    "  apply,",
    "  verify,",
    "};",
    "",
    `// Then add to src/lib/remediation/registry.ts:`,
    `//   import { defect as ${camel(id)} } from "./defects/${id}";`,
    `//   DEFECTS.push(${camel(id)})  -- or append to the array literal`,
    "",
  ].join("\n");
}

function camel(id: string): string {
  return id
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((part, i) => (i === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join("");
}

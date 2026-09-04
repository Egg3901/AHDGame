// AHD-1271 (c): secondary National Corporations stamped `type: "financial"`.
//
// `buildNationalCorporationDoc` defaults `type` to "financial", which is right
// for the PRIMARY National Corporation — a country's sovereign issuer really is
// a financial entity — and wrong for the producing split-offs
// `splitOffSectorType` carves out of it. That path passed `name`,
// `assignedSectorTypes` and the primary flag but never `type`, so every state
// enterprise a country created inherited the issuer's default.
//
// This is not cosmetic. `corporation.type` is the sector a corp builds into when
// none is named (`expandSector`, `buildCapacity`) and one of the keys
// `applyPriceMultipliers` reads, so a German Manufacturing Enterprise whose
// `type` says financial expands into the financial sector.
//
// On live it hit the ten enterprises a reunified Germany carved out after the
// merge: Manufacturing, Retail, Agriculture, Logistics, Media, Technology,
// Telecommunications, Real Estate, Healthcare and Automobiles, each holding its
// own sixteen plants and each reporting itself as a financial firm.
//
// Half A (code): `splitOffSectorType` stamps `type` from the sector it claims.
// Half B (this heal): restate `type` from `assignedSectorTypes` on the corps
// already carved out.

import type { Db } from "mongodb";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import type {
  Defect,
  DetectResult,
  HealContext,
  HealPlan,
  HealResult,
  VerifyResult,
} from "../types";

export const DEFECT_ID = "AHD-1271-natcorp-split-sector-type";

interface SplitOffCorp {
  _id: unknown;
  name?: string;
  countryOwnerId?: string;
  type?: string;
  assignedSectorTypes?: string[];
  isPrimaryNationalCorporation?: boolean;
  unlockedTechNodeIds?: string[];
  techDecadeLane?: Record<string, string> | null;
  secondaryType?: string;
  typeSwitchTurn?: number | null;
}

/**
 * Does this corp hold research that a primary-type switch would silently void?
 *
 * Sector-lane tech node ids are PREFIXED BY PRIMARY TYPE, so `getTreeForType`
 * stops resolving a corp's unlocked ids the moment its `type` moves: the nodes
 * vanish from `getUnlockedNodes`, and the R&D and cash spent on them go with
 * them. The product rule for a deliberate switch is that this is the price
 * (`migrateUnlockedTechOnPrimaryTypeSwitch` drops them and reverses the strength
 * grants), but that is a CHOICE a player makes. A repair pass must not make it
 * for them, so a corp carrying unlocks or a decade lane commitment is reported
 * and left alone. Zero of the thirty live corps qualify, so this costs nothing
 * today and stops the heal being unsafe the first time one does.
 */
function holdsResearch(corp: SplitOffCorp): boolean {
  return (
    (corp.unlockedTechNodeIds?.length ?? 0) > 0 || Object.keys(corp.techDecadeLane ?? {}).length > 0
  );
}

/**
 * State-owned split-offs whose `type` contradicts the single sector they claim.
 *
 * The PRIMARY National Corporation is excluded by filter, not by inference: it
 * legitimately carries `type: "financial"` with no assigned sector, and
 * rewriting it would break the sovereign issuer lookup. A corp claiming more
 * than one sector type is also skipped — `type` is a single value and there is
 * no correct answer to pick, so those are reported instead.
 *
 * SCOPED BY `countryOwnerId`, which in practice means National Corporations and
 * nothing else: that field is written only by `buildNationalCorporationDoc`, the
 * seed, the command-economy reconcile and `mergeCountry`. A seized private firm
 * is state-owned through the OTHER half of the codebase's predicate
 * (`ownershipState: "stateOwned"`), which this filter does not include, and none
 * of those paths write `assignedSectorTypes` anyway. Every row is named in the
 * plan for the operator to read before approving.
 */
async function findMistyped(db: Db): Promise<{
  rows: SplitOffCorp[];
  multiClaimCount: number;
  researchHolders: SplitOffCorp[];
  conflictingSecondary: SplitOffCorp[];
  playerSwitched: SplitOffCorp[];
  nonEnumClaim: SplitOffCorp[];
}> {
  const corps = await db
    .collection<SplitOffCorp>("corporations")
    .find(
      {
        countryOwnerId: { $type: "string" },
        isPrimaryNationalCorporation: { $ne: true },
        assignedSectorTypes: { $exists: true, $ne: [] },
      } as Record<string, unknown>,
      {
        projection: {
          name: 1,
          countryOwnerId: 1,
          type: 1,
          assignedSectorTypes: 1,
          unlockedTechNodeIds: 1,
          techDecadeLane: 1,
          secondaryType: 1,
          typeSwitchTurn: 1,
        },
      }
    )
    .toArray();

  const rows: SplitOffCorp[] = [];
  const researchHolders: SplitOffCorp[] = [];
  const conflictingSecondary: SplitOffCorp[] = [];
  const playerSwitched: SplitOffCorp[] = [];
  const nonEnumClaim: SplitOffCorp[] = [];
  let multiClaimCount = 0;
  for (const corp of corps) {
    const claimed = corp.assignedSectorTypes ?? [];
    if (claimed.length !== 1) {
      // Counted whatever its `type` says. A multi-claim corp is untouched either
      // way and equally needs a human to decide, so excluding the ones that
      // happen to match `claimed[0]` would just hide half of them from the note.
      if (claimed.length > 1) multiClaimCount++;
      continue;
    }
    const want = claimed[0];
    // Only ever move `type` to a real CorporationType. A claim outside the enum
    // is data this heal does not understand and must not act on, and it is
    // REPORTED rather than dropped in silence: an unreadable claim is something
    // an operator should know about even though nothing here can fix it.
    if (!CORPORATION_TYPES.includes(want as never)) {
      nonEnumClaim.push(corp);
      continue;
    }
    if (corp.type === want) continue;
    // A DELIBERATE SWITCH IS NOT A DEFECT. `typeSwitchTurn` is stamped only by
    // `updateCorporationSettings`, so it means a human chose this type and paid
    // the switch penalty and cooldown for it. An appointed National Corporation
    // CEO can do that, and `assignedSectorTypes` stays as carved, so such a corp
    // reads as "mistyped" forever: reverting it would spend their penalty for
    // nothing and the defect would re-open every time they set it back.
    if (corp.typeSwitchTurn != null) playerSwitched.push(corp);
    // `updateCorporationSettings` rejects primary === secondary as invalid, so
    // writing that pair here would leave a corp its own owner cannot edit.
    else if (corp.secondaryType === want) conflictingSecondary.push(corp);
    else if (holdsResearch(corp)) researchHolders.push(corp);
    else rows.push(corp);
  }
  return {
    rows,
    multiClaimCount,
    researchHolders,
    conflictingSecondary,
    playerSwitched,
    nonEnumClaim,
  };
}

function describe(corp: SplitOffCorp): string {
  return `${corp.countryOwnerId}/${corp.name}: ${corp.type} -> ${corp.assignedSectorTypes?.[0]}`;
}

async function detect(db: Db): Promise<DetectResult> {
  const {
    rows,
    multiClaimCount,
    researchHolders,
    conflictingSecondary,
    playerSwitched,
    nonEnumClaim,
  } = await findMistyped(db);
  const notes = [`${rows.length} state enterprise(s) report a type they do not operate`];
  if (multiClaimCount > 0) {
    notes.push(
      `${multiClaimCount} enterprise(s) claim several sector types and are NOT touched: \`type\` holds one value and picking one would be a guess`
    );
  }
  if (researchHolders.length > 0) {
    notes.push(
      `${researchHolders.length} enterprise(s) hold tech-tree research and are NOT touched: ` +
        `moving \`type\` voids unlocks bought with R&D, and that is a player's decision ` +
        `(${researchHolders.map((c) => `${c.countryOwnerId}/${c.name}`).join(", ")})`
    );
  }
  if (conflictingSecondary.length > 0) {
    notes.push(
      `${conflictingSecondary.length} enterprise(s) already carry the claimed sector as their ` +
        `SECONDARY type and are NOT touched: primary and secondary must differ, and writing ` +
        `both the same would leave a corp its owner cannot edit ` +
        `(${conflictingSecondary.map((c) => `${c.countryOwnerId}/${c.name}`).join(", ")})`
    );
  }
  if (playerSwitched.length > 0) {
    notes.push(
      `${playerSwitched.length} enterprise(s) had their type set deliberately by a CEO and are ` +
        `NOT touched: reverting a paid-for switch is not a repair ` +
        `(${playerSwitched.map((c) => `${c.countryOwnerId}/${c.name}`).join(", ")})`
    );
  }
  if (nonEnumClaim.length > 0) {
    notes.push(
      `${nonEnumClaim.length} enterprise(s) claim a sector type that is not a real one and are ` +
        `NOT touched: this heal cannot read the claim, so it cannot act on it ` +
        `(${nonEnumClaim.map((c) => `${c.countryOwnerId}/${c.name}`).join(", ")})`
    );
  }
  return {
    affected: rows.length,
    sample: rows.slice(0, 10).map((corp) => ({
      id: String(corp._id),
      name: corp.name,
      countryOwnerId: corp.countryOwnerId,
      type: corp.type,
      operates: corp.assignedSectorTypes?.[0],
    })),
    notes,
  };
}

async function plan(db: Db): Promise<HealPlan> {
  const { rows } = await findMistyped(db);
  return {
    affected: rows.length,
    touched: [{ collection: "corporations", ids: rows.map((corp) => String(corp._id)) }],
    // A label, not a balance. No cash, shares or capital move.
    moneyDelta: 0,
    summary: `restate \`type\` from the claimed sector on ${rows.length} state enterprise(s)`,
    notes: rows.slice(0, 20).map(describe),
  };
}

async function apply(db: Db, healPlan: HealPlan, ctx: HealContext): Promise<HealResult> {
  const approved = new Set(
    healPlan.touched.find((t) => t.collection === "corporations")?.ids ?? []
  );
  const { rows } = await findMistyped(db);
  const now = ctx.now;

  let updated = 0;
  for (const corp of rows) {
    if (!approved.has(String(corp._id))) continue;
    const want = corp.assignedSectorTypes?.[0];
    if (!want) continue;
    const res = await db.collection("corporations").updateOne(
      // The stale type is part of the filter, so a concurrent correction wins.
      { _id: corp._id, type: corp.type, assignedSectorTypes: [want] } as Record<string, unknown>,
      { $set: { type: want, updatedAt: now } }
    );
    updated += res.modifiedCount ?? 0;
  }

  return {
    documentsScanned: rows.length,
    documentsUpdated: updated,
    notes: [
      `restated ${updated} of ${approved.size} approved enterprise(s)`,
      ...rows
        .filter((corp) => approved.has(String(corp._id)))
        .slice(0, 20)
        .map(describe),
    ],
  };
}

async function verify(db: Db): Promise<VerifyResult> {
  const {
    rows,
    multiClaimCount,
    researchHolders,
    conflictingSecondary,
    playerSwitched,
    nonEnumClaim,
  } = await findMistyped(db);
  return {
    ok: rows.length === 0,
    remaining: rows.length,
    notes: [
      rows.length === 0
        ? "every single-sector state enterprise reports the sector it operates"
        : `${rows.length} enterprise(s) still mistyped`,
      `${multiClaimCount} multi-sector enterprise(s) remain, by design`,
      `${researchHolders.length} research-holding enterprise(s) remain, by design`,
      `${conflictingSecondary.length} enterprise(s) whose secondary type is the claimed sector remain, by design`,
      `${playerSwitched.length} enterprise(s) with a deliberate CEO type switch remain, by design`,
      `${nonEnumClaim.length} enterprise(s) with an unreadable sector claim remain, by design`,
    ],
  };
}

export const defect: Defect = {
  id: DEFECT_ID,
  title: "Secondary National Corporations report the primary's financial type",
  severity: "P2",
  codeFix: {
    issue: 1271,
    mergedTo: "development",
  },
  // The seeded SOEs are built by `buildCommandSoeCorpEntries`, which stamps
  // `type: sectorType` directly and always has. Only the runtime split-off path
  // could produce the mismatch.
  seedFix: {
    status: "not-needed",
    files: ["src/lib/seeds/reference/budgets.ts"],
    note: "buildCommandSoeCorpEntries stamps type from the sector; the corruption is runtime-only",
  },
  // ENVS DELIBERATELY EXCLUDE prod UNTIL `requiredCommit` IS PINNED. The ledger
  // gate (`evaluateCodeGate`) passes unconditionally when `requiredCommit` is
  // absent, so listing prod here today would let an operator heal an environment
  // the code half has not reached: production deploys `main`, and this fix is on
  // `development`. Healing there would re-corrupt on the next write, which is the
  // treadmill the ledger exists to prevent. Pin the squash-merge SHA and add
  // "prod" in the same change.
  envs: ["dev", "sandbox"],
  idempotent: true,
  guards: ["turn-lock-free", "money-conserving", "max-affected:500"],
  detect,
  plan,
  apply,
  verify,
};

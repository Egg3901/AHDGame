import type { Collection, Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CommodityType } from "@/lib/constants/commodities";
import type { TradeEmbargo } from "@/lib/db/types/tradeEmbargo";
import type { TradeEmbargoCooldown } from "@/lib/db/types/tradeEmbargoCooldown";
import {
  TRADE_EMBARGO_MAX_DURATION_TURNS,
  TRADE_EMBARGO_MAX_ACTIVE_PER_MEMBER,
  TRADE_EMBARGO_TARGET_COOLDOWN_TURNS,
} from "@/lib/trade/constants";

const COLLECTION = "tradeEmbargoes";
const COOLDOWN_COLLECTION = "embargoCooldowns";

/** MongoDB duplicate-key error (E11000) — used to detect the cooldown-gate race. */
function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: number }).code === 11000
  );
}

// The cooldown gate relies on a unique index over (sourceCountry,targetCountry).
// Seeding creates it, but ensure it once per process too so the atomic gate is
// correct even on a DB that predates the seed change. createIndex is idempotent.
let cooldownIndexEnsured = false;
async function ensureCooldownIndex(col: Collection<TradeEmbargoCooldown>): Promise<void> {
  if (cooldownIndexEnsured) return;
  await col.createIndex({ sourceCountry: 1, targetCountry: 1 }, { unique: true });
  cooldownIndexEnsured = true;
}

export interface ImposeEmbargoInput {
  sourceCountry: CountryId;
  targetCountry: CountryId;
  commodity: CommodityType | "all";
  direction: "export" | "import" | "both";
  mode: "block" | "cap";
  /** Required when mode === "cap" — flow cap in commodity units. */
  cap?: number;
  /** Turns the embargo lasts from now (minister embargoes are temporary). */
  durationTurns: number;
  currentTurn: number;
  createdBy: ObjectId;
}

export type EmbargoCommandResult = { ok: true; embargoId: ObjectId } | { ok: false; error: string };

/**
 * Impose a temporary (minister-origin) trade embargo. Validates the pair and
 * mode, rejects duplicates of an active embargo on the same directed
 * source→target→commodity, and inserts a record the clearing engine will apply
 * from the next turn. DB-touching but logic-focused.
 */
export async function imposeEmbargo(
  db: Db,
  input: ImposeEmbargoInput
): Promise<EmbargoCommandResult> {
  if (input.sourceCountry === input.targetCountry) {
    return { ok: false, error: "A country cannot embargo itself." };
  }
  if (input.mode === "cap" && !(typeof input.cap === "number" && input.cap >= 0)) {
    return { ok: false, error: "A cap embargo requires a non-negative cap." };
  }
  if (input.durationTurns <= 0) {
    return { ok: false, error: "Embargo duration must be positive." };
  }
  if (input.durationTurns > TRADE_EMBARGO_MAX_DURATION_TURNS) {
    return {
      ok: false,
      error: `A ministerial embargo can last at most ${TRADE_EMBARGO_MAX_DURATION_TURNS} turns.`,
    };
  }

  const col = db.collection<TradeEmbargo>(COLLECTION);
  const activeFilter = [
    { expiresTurn: { $exists: false } },
    { expiresTurn: { $gte: input.currentTurn } },
  ];

  const existing = await col.findOne({
    sourceCountry: input.sourceCountry,
    targetCountry: input.targetCountry,
    commodity: input.commodity,
    direction: input.direction,
    origin: "minister",
    $or: activeFilter,
  });
  if (existing) {
    return { ok: false, error: "An active embargo already covers this pair and commodity." };
  }

  // Cap on simultaneously-active ministerial embargoes per cabinet member.
  // Best-effort count; the hard concurrency bound is the atomic cabinet-action
  // spend in the route — a member reaches this path at most as many times as they
  // have actions, which is ≤ the cap, so a race can't exceed it.
  const activeForMember = await col.countDocuments({
    origin: "minister",
    createdBy: input.createdBy,
    $or: activeFilter,
  });
  if (activeForMember >= TRADE_EMBARGO_MAX_ACTIVE_PER_MEMBER) {
    return {
      ok: false,
      error: `You already have ${TRADE_EMBARGO_MAX_ACTIVE_PER_MEMBER} active ministerial embargoes. Lift one before imposing another.`,
    };
  }

  // Per-target cooldown gate — atomic. A conditional upsert keyed by the unique
  // (sourceCountry,targetCountry) index either acquires/refreshes the lock when
  // it's absent or expired, or throws a duplicate-key error when an active lock
  // already exists. This makes two concurrent imposes on the same target
  // race-free: exactly one wins. Survives lift/expiry by design (it outlives the
  // embargo), so a minister can't lift-and-re-impose to dodge it.
  const cooldownCol = db.collection<TradeEmbargoCooldown>(COOLDOWN_COLLECTION);
  await ensureCooldownIndex(cooldownCol);
  try {
    await cooldownCol.findOneAndUpdate(
      {
        sourceCountry: input.sourceCountry,
        targetCountry: input.targetCountry,
        cooldownUntilTurn: { $lte: input.currentTurn },
      },
      {
        $set: {
          lastEnactedTurn: input.currentTurn,
          cooldownUntilTurn: input.currentTurn + TRADE_EMBARGO_TARGET_COOLDOWN_TURNS,
          characterId: input.createdBy,
        },
      },
      { upsert: true }
    );
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      const active = await cooldownCol.findOne({
        sourceCountry: input.sourceCountry,
        targetCountry: input.targetCountry,
      });
      const until = active?.cooldownUntilTurn ?? input.currentTurn;
      const remaining = Math.max(1, until - input.currentTurn);
      return {
        ok: false,
        error: `A ministerial embargo on this country is on cooldown for ${remaining} more turn${remaining === 1 ? "" : "s"} (until turn ${until}). Use legislation for a durable embargo.`,
      };
    }
    throw err;
  }

  const doc = {
    sourceCountry: input.sourceCountry,
    targetCountry: input.targetCountry,
    commodity: input.commodity,
    direction: input.direction,
    mode: input.mode,
    ...(input.mode === "cap" ? { cap: input.cap } : {}),
    origin: "minister" as const,
    expiresTurn: input.currentTurn + input.durationTurns,
    createdTurn: input.currentTurn,
    createdBy: input.createdBy,
  };
  let res;
  try {
    res = await col.insertOne(doc as TradeEmbargo);
  } catch (err) {
    // Insert failed after acquiring the cooldown — release the lock we just took.
    // It was absent or expired before we acquired it, so removing it restores the
    // correct "no active embargo, no live cooldown" state rather than stranding a
    // 168-turn lock over an embargo that never enacted.
    await cooldownCol
      .deleteOne({ sourceCountry: input.sourceCountry, targetCountry: input.targetCountry })
      .catch(() => {});
    throw err;
  }

  return { ok: true, embargoId: res.insertedId };
}

/**
 * Lift an active minister embargo by id. Only minister-origin embargoes can be
 * lifted this way (durable/legislation embargoes are repealed via the bill that
 * created them). Verifies the embargo belongs to `sourceCountry`.
 */
export async function liftEmbargo(
  db: Db,
  embargoId: ObjectId,
  sourceCountry: CountryId
): Promise<EmbargoCommandResult> {
  const col = db.collection<TradeEmbargo>(COLLECTION);
  const embargo = await col.findOne({ _id: embargoId });
  if (!embargo) return { ok: false, error: "Embargo not found." };
  if (embargo.sourceCountry !== sourceCountry) {
    return { ok: false, error: "This embargo belongs to another country." };
  }
  if (embargo.origin !== "minister") {
    return { ok: false, error: "Durable embargoes must be repealed through legislation." };
  }
  await col.deleteOne({ _id: embargoId });
  return { ok: true, embargoId };
}

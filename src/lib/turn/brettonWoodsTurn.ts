/**
 * Bretton Woods exit turn shell — the documented boundary for
 * `isBrettonWoodsExitEnabled` (gameConfig `brettonWoodsExitEnabled`).
 *
 * Runs in `stateEffectsAndNationalAggregation` ahead of `inflationRecalc` and
 * `forexTurn`, which read the regime this phase writes. The economics live in
 * the pure rules module (`src/lib/monetary/brettonWoods.ts`); this file only
 * loads documents, calls the rules, and persists the results.
 *
 * Gate behavior:
 * - Flag off/absent: returns `{ ran: false }` after a single gameConfig read.
 *   No gold cover is tracked, no regime is written — byte-identical to the
 *   pegged world.
 * - Flag on: steps the US gold-cover stock, evaluates the suspension/float
 *   transitions, and persists the four `bw*` fields on the gameState singleton.
 *
 * State model (all on the gameState singleton, all absent-legacy):
 * - `bwGoldCover` (absent ⇒ 1): stepped with `stepGoldCover`. Initialized full
 *   so enabling the flag mid-run never suspends anything abruptly — a fresh
 *   world must earn the exit through sustained pressure, which takes hundreds
 *   of turns to move cover from 1 to the 0.25 suspension threshold.
 * - `bwForeignClaims` (absent ⇒ 0): cumulative foreign dollar-claims overhang
 *   as a coverage ratio against a unit gold stock. Each turn it absorbs the
 *   US excess-money-growth slice (annualized M2 growth above real GDP growth);
 *   when no M2 observation exists yet, the US inflation gap stands in as the
 *   money-printing proxy. Floored at 0; sustained US surpluses unwind it.
 *   `stepGoldCover` drains only on claims IN EXCESS of cover, so the stock
 *   must first climb past 1 before the claims term bites.
 * - `bwRegime` (absent ⇒ "pegged") + `bwRegimeChangedAtTurn`: the
 *   pegged → suspended → floating state machine, transitioned with
 *   `shouldSuspendConvertibility` (era-gated at 1968+) and `shouldFloat`
 *   (90-turn suspension). Transitions are one-way and never re-fire.
 *
 * Round trips: 4 reads (gameConfig, gameState, US bank, latest USD money
 * snapshot) + 1 gameState write, all singleton lookups — no per-row loop.
 */
import type { Db } from "mongodb";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import type { GameState } from "@/lib/db/types/gameState";
import { getBankId } from "@/lib/centralBank/helpers";
import { resolveMonetaryBaseline } from "@/lib/currency/rateCalculation";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { currentMoneyGrowth } from "@/lib/moneySupply/rules/growthSignal";
import {
  stepGoldCover,
  shouldSuspendConvertibility,
  shouldFloat,
  type MonetaryRegime,
} from "@/lib/monetary/brettonWoods";
import { isBrettonWoodsExitEnabled } from "@/lib/monetary/featureFlag";

export interface BrettonWoodsTurnResult {
  ran: boolean;
  regime: MonetaryRegime;
  regimeChangedAtTurn: number | null;
  goldCover: number;
  foreignClaims: number;
  suspended: boolean;
  floated: boolean;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export async function processBrettonWoodsTurn(
  db: Db,
  turn: number,
  currentYear?: number | null
): Promise<BrettonWoodsTurnResult> {
  const idle: BrettonWoodsTurnResult = {
    ran: false,
    regime: "pegged",
    regimeChangedAtTurn: null,
    goldCover: 1,
    foreignClaims: 0,
    suspended: false,
    floated: false,
  };

  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { brettonWoodsExitEnabled: 1 } });
  if (!isBrettonWoodsExitEnabled(config)) return idle;

  const gs = await db.collection<GameState>("gameState").findOne(
    { _id: "current" },
    {
      projection: {
        currentYear: 1,
        bwGoldCover: 1,
        bwForeignClaims: 1,
        bwRegime: 1,
        bwRegimeChangedAtTurn: 1,
      },
    }
  );
  if (!gs) return { ...idle, ran: true };

  const year = currentYear ?? gs.currentYear ?? null;

  const usBank = await db
    .collection<CentralBank>("centralBanks")
    .findOne(
      { _id: getBankId("US") },
      { projection: { inflationHistory: 1, gdpGrowthHistory: 1 } }
    );
  if (!usBank) {
    return {
      ran: true,
      regime: gs.bwRegime ?? "pegged",
      regimeChangedAtTurn: gs.bwRegimeChangedAtTurn ?? null,
      goldCover: finiteOr(gs.bwGoldCover, 1),
      foreignClaims: finiteOr(gs.bwForeignClaims, 0),
      suspended: false,
      floated: false,
    };
  }

  const usInflation = finiteOr(usBank.inflationHistory?.at(-1)?.rate, 0);
  const usGdpGrowth = finiteOr(usBank.gdpGrowthHistory?.at(-1)?.rate, 0);
  const usTarget = resolveMonetaryBaseline("US", year)?.targetInflation ?? 2;
  const inflationGap = usInflation - usTarget;

  const m2Row = await db
    .collection("moneySupplySnapshots")
    .findOne(
      { currencyCode: "USD", turn: { $lt: turn } },
      { sort: { turn: -1 }, projection: { annualizedM2GrowthPct: 1, accountingVersion: 1 } }
    );
  const m2Growth = currentMoneyGrowth(
    m2Row as { accountingVersion?: number; annualizedM2GrowthPct: number | null } | null
  );
  // Excess money creation in pp/yr. Without an M2 observation the inflation gap
  // is the money-printing proxy; either way a calm US accumulates nothing.
  const excessPp = m2Growth != null ? m2Growth - usGdpGrowth : inflationGap;
  const prevClaims = finiteOr(gs.bwForeignClaims, 0);
  const foreignClaims = Math.max(0, prevClaims + Math.max(0, excessPp) / 100 / TURNS_PER_YEAR);

  const prevCover = finiteOr(gs.bwGoldCover, 1);
  const goldCover = stepGoldCover({
    cover: prevCover,
    foreignClaims,
    goldValue: 1,
    inflationGap,
  });

  let regime: MonetaryRegime = gs.bwRegime ?? "pegged";
  let regimeChangedAtTurn: number | null = gs.bwRegimeChangedAtTurn ?? null;
  let suspended = false;
  let floated = false;
  if (shouldSuspendConvertibility({ currentYear: year, goldCover, regime })) {
    regime = "suspended";
    regimeChangedAtTurn = turn;
    suspended = true;
  } else if (
    shouldFloat({ regime, turnsSinceRegimeChange: turn - (regimeChangedAtTurn ?? turn) })
  ) {
    regime = "floating";
    regimeChangedAtTurn = turn;
    floated = true;
  }

  await db
    .collection<GameState>("gameState")
    .updateOne(
      { _id: "current" },
      {
        $set: {
          bwGoldCover: goldCover,
          bwForeignClaims: foreignClaims,
          bwRegime: regime,
          ...(regimeChangedAtTurn != null ? { bwRegimeChangedAtTurn: regimeChangedAtTurn } : {}),
        },
      }
    );

  return { ran: true, regime, regimeChangedAtTurn, goldCover, foreignClaims, suspended, floated };
}

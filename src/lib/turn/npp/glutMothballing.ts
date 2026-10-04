/**
 * NPP corporations mothball plants during gluts or chronic losses and restart as prices recover.
 * buildNppGlutMothballUpdates emits at most one transition per eligible corporation and turn.
 */
import type { ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import {
  GLUT_MOTHBALL_FILL_THRESHOLD,
  GLUT_MOTHBALL_PRICE_RATIO,
  GLUT_RESTART_PRICE_RATIO,
  COST_MOTHBALL_LOSS_TURNS,
} from "@/lib/turn/npp/nppCorporationTuning";
import { glutStaggerEligible } from "@/lib/turn/npp/cohort";
import { sectorShortageScore, type CommodityPriceRatioFn } from "@/lib/turn/npp/marketSignals";
import { chooseCostMothballSector } from "@/lib/turn/npp/costMothball";
import type { SectorProfitInfo } from "@/lib/turn/npp/sectorProfitability";
import type { NppCorpDecision } from "./corpDecisionTypes";

/** Resolve the gradual glut and chronic-loss mothball transitions for one corp. */
export function buildNppGlutMothballUpdates(args: {
  corporation: Corporation;
  turn: number;
  now: Date;
  plantsEnabled: boolean;
  sectorProfits: SectorProfitInfo[];
  divestedSectorIds: ObjectId[];
  priceRatioOf: CommodityPriceRatioFn;
}): NppCorpDecision["sectorUpdates"] {
  const {
    corporation: corp,
    turn,
    now,
    plantsEnabled,
    sectorProfits,
    divestedSectorIds,
    priceRatioOf,
  } = args;
  const sectorUpdates: NppCorpDecision["sectorUpdates"] = [];

  // Sections 2a/2b only STOP a glutted sector from growing; nothing ever takes
  // existing capacity OFF the market. Under plants that matters: NPP plants
  // seeded at national-economy scale (100k-300k units/day) keep producing
  // full-tilt into markets clearing at soldFraction 0.01-0.08, pinning every
  // finished-good price to the log-curve floor and starving player plants of
  // fill (ticket #1027: chemicals sat 72x oversupplied, advertising 125x).
  // Negative productionPolicy is the WRONG lever for this (its lean-ops
  // asymmetry cuts input demand harder than output and worsened gluts, GH
  // #3370); mothballing is the right one. A mothballed plant is cold on BOTH
  // sides, so a glutted market loses supply while the extraction inputs it was
  // hoarding (all in shortage, live fertilizers fill 0.1) are released.
  //
  // Deliberately gradual and self-limiting: a corp is only ELIGIBLE for a
  // state change on its stagger slot (see GLUT_STATE_CHANGE_STAGGER; young
  // worlds are wall-to-wall single-sector NPP corps, so per-corp limits alone
  // are cohort-wide cliffs), at most ONE change per corp per turn, and only
  // while the sector's own fill is under GLUT_MOTHBALL_FILL_THRESHOLD. As
  // capacity idles, surviving sellers' fill rises and the trigger stops
  // firing. A single-sector corp MAY go fully cold: the restart pass prices
  // its market without needing fill, so cold is recoverable, and exempting
  // last sectors would exempt essentially the whole glut. Restarts use the
  // price signal with a wide hysteresis band and are preferred over new
  // mothballs so a recovering market reactivates before it sheds more.
  // State-owned corps (countryOwnerId) are exempt: SOEs are policy
  // instruments, not margin-seekers.
  if (plantsEnabled && !corp.countryOwnerId && glutStaggerEligible(corp._id.toString(), turn)) {
    let stateChangeBudget = 1;

    // Restart pass first: recovering markets reactivate before anything sheds.
    for (const sp of sectorProfits) {
      if (stateChangeBudget <= 0) break;
      if (sp.sector.mothballed !== true) continue;
      if (divestedSectorIds.includes(sp.sector._id)) continue;
      const ratio = sectorShortageScore(
        sp.sector.sectorType,
        sp.sector.countryId ?? corp.countryId,
        priceRatioOf
      );
      if (ratio >= GLUT_RESTART_PRICE_RATIO) {
        sectorUpdates.push({
          filter: { _id: sp.sector._id },
          // A revived plant re-earns chronic-cost status from zero instead
          // of mothballing again on its first losing turn (step 5).
          update: { $set: { mothballed: false, pnlLossTurns: 0, updatedAt: now } },
        });
        stateChangeBudget -= 1;
      }
    }

    if (stateChangeBudget > 0) {
      let worst: { sp: SectorProfitInfo; fill: number } | null = null;
      for (const sp of sectorProfits) {
        if (sp.sector.mothballed === true) continue;
        if (divestedSectorIds.includes(sp.sector._id)) continue;
        // Extraction is excluded: every extractable is shortage-side (its
        // fill is ~1 so the gate would never fire) and its output/rationing
        // legs live outside the clearing book this signal reads.
        if (sp.sector.sectorType === "extraction") continue;
        const fill = sp.sector.soldFraction;
        // soldFraction is only written under clearing mode; a sector that
        // has never cleared (mid-build, legacy) is not a candidate.
        if (fill == null || fill >= GLUT_MOTHBALL_FILL_THRESHOLD) continue;
        const ratio = sectorShortageScore(
          sp.sector.sectorType,
          sp.sector.countryId ?? corp.countryId,
          priceRatioOf
        );
        if (ratio > GLUT_MOTHBALL_PRICE_RATIO) continue;
        if (worst == null || fill < worst.fill) worst = { sp, fill };
      }
      if (worst) {
        sectorUpdates.push({
          filter: { _id: worst.sp.sector._id },
          update: { $set: { mothballed: true, updatedAt: now } },
        });
      } else {
        // Filled plants can still lose money. Mothball the longest-running loss;
        // this reversible action shares the budget and follows fill-based sheds.
        const coldest = chooseCostMothballSector(
          sectorProfits,
          divestedSectorIds,
          COST_MOTHBALL_LOSS_TURNS
        );
        if (coldest) {
          sectorUpdates.push({
            filter: { _id: coldest.sector._id },
            update: { $set: { mothballed: true, updatedAt: now } },
          });
        }
      }
    }
  }

  return sectorUpdates;
}

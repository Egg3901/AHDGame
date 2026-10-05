import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { PartyStrengthPressure, StatePartyOrg, PoliticalParty } from "@/lib/db/types";
import type { AuthUserWithCharacter } from "@/lib/auth";
import { checkPartyPresence } from "@/lib/turn/partyOrg/presence";
import {
  canSpendOnStateParty,
  resolveSpenderScope,
  resolveSpenderScopeEligibility,
  type SpenderScopeEligibility,
} from "@/lib/parties/access";
import {
  BUILD_ORG_BASE_PS_COST,
  effectivePsCost,
} from "@/lib/turn/politicalStrength/strengthConstants";
import { orgBuildCashPrice, resolveOrgBuildFunding } from "@/lib/politicalStrength/buildOrgFunding";
import { resolveOrgBuildSizeMultiplier } from "@/lib/politicalStrength/orgBuildStateSize";
import { applyOrganizationBuild } from "@/lib/parties/rules/organizationBucket";
import { ORG_BUILD_UNITS_PER_CLICK } from "@/lib/constants/partyOrg";

/**
 * Canonical Build Org projection, shared by the
 * read-only preview GET route and the spend POST route (which returns it as the
 * `nextPreview` for the following click). Centralizing it here guarantees the
 * pre-click estimate and the post-click charge/gain use the same effective PS
 * cost, fixed contribution, and bucket-share derivation.
 *
 * Read-only: reads `statePartyOrg`, `politicalParties`, and
 * `partyStrengthPressure` but mutates nothing, so the POST can call it *after*
 * committing a spend to project the next click against fresh state.
 */
export type BuildOrgPreviewResult =
  | {
      ok: true;
      /** Effective PS cost of the next click (base + current pressure, capped). */
      effectiveCost: number;
      /** Current per-(party, state) pressure-ladder value. */
      pressureValue: number;
      /** Cash price of the next click, in the paying tier's local currency. */
      cashPrice: number;
      /**
       * Per-state size multiplier already folded into `cashPrice` — above 1 in a
       * state larger than its country's average, below 1 in a smaller one.
       * Surfaced so the UI can explain why the same action costs more here.
       */
      sizeMultiplier: number;
      /** Balance of the treasury that would pay (state or national, per `scope`). */
      treasuryAvailable: number;
      /**
       * `min(1, treasury / cashPrice)`. Retained for the existing soft cash
       * charge; every successful click still deposits the same fixed unit.
       */
      fundedFraction: number;
      /** Fixed contribution deposited by the next successful click. */
      contributionUnits: number;
      /** Spender's contribution balance after the projected click. */
      projectedOrganizationUnits: number;
      /** Org% share change produced by that fixed contribution. */
      projectedGain: number;
      /** Existing parties whose percentage share would be diluted. */
      dilutions: {
        partyId: string;
        loss: number;
      }[];
      scope: "state" | "national-targeted";
      eligibleScopes: SpenderScopeEligibility;
    }
  | {
      ok: false;
      reason: "no-presence" | "auth" | "insufficient-funds";
      message: string;
    };

export interface ComputeBuildOrgPreviewParams {
  countryId: CountryId;
  /** Upper-cased region id. */
  upperRegionId: string;
  /** Resolved spender party doc (national tier). */
  spenderParty: PoliticalParty;
  authUser: AuthUserWithCharacter;
  /**
   * Which PS pool the caller intends to spend, when it already knows.
   *
   * Load-bearing for the money side: the tier decides both the rate (national is
   * twice state) and which treasury is checked. The national HQ's bulk tool
   * always posts `psPool: "national"`, so without this a dual-role officer would
   * be quoted the state price against the state treasury and then charged the
   * national price against the national one.
   *
   * Honored only where the spender is actually eligible for that tier;
   * `resolveSpenderScope` falls back otherwise.
   */
  preferredScope?: "state" | "national-targeted";
}

export async function computeBuildOrgPreview(
  db: Db,
  { countryId, upperRegionId, spenderParty, authUser, preferredScope }: ComputeBuildOrgPreviewParams
): Promise<BuildOrgPreviewResult> {
  // The spender row MAY be absent (seed deliberately omits e.g. CDU in Bayern).
  // Project from a virtual 0% row so the preview matches the POST's bootstrap —
  // read-only, no mutation. Presence (checked next) is the real gate.
  const spenderRow = await db.collection<StatePartyOrg>("statePartyOrg").findOne({
    countryId,
    stateId: upperRegionId,
    partyId: String(spenderParty.sequentialId),
  });

  // Live presence check (mirrors the POST route) rather than the cached
  // `statePartyOrg.hasPresence` flag, which only refreshes on membership events.
  const hasPresence = await checkPartyPresence(
    db,
    upperRegionId,
    String(spenderParty.sequentialId)
  );
  if (!hasPresence) {
    return {
      ok: false,
      reason: "no-presence",
      message:
        "Cannot build org without presence in this state. Establish a player or elected official here first.",
    };
  }

  if (!canSpendOnStateParty(spenderParty, spenderRow, authUser)) {
    return {
      ok: false,
      reason: "auth",
      message: "Only the party chair, vice chair, an assigned campaigner, or admin can build org",
    };
  }

  const allStateRows = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .find({ countryId, stateId: upperRegionId })
    .toArray();
  const previewRowId =
    spenderRow?._id ?? `preview:${countryId}:${upperRegionId}:${spenderParty.sequentialId}`;
  const previewRows = spenderRow
    ? allStateRows
    : [
        ...allStateRows,
        {
          _id: previewRowId,
          organization: 0,
          organizationUnits: 0,
          lastOrganizationBuildTurn: undefined,
          partyId: String(spenderParty.sequentialId),
        },
      ];
  const bucketResult = applyOrganizationBuild(
    previewRows.map((row) => ({
      id: row._id,
      organization: row.organization ?? 0,
      organizationUnits: row.organizationUnits,
      lastOrganizationBuildTurn: row.lastOrganizationBuildTurn,
    })),
    previewRowId,
    0
  );
  const ownProjection = bucketResult.rows.find((row) => row.id === previewRowId);
  if (!ownProjection) throw new Error("Build Org preview could not resolve spender bucket row");
  const partyIdByRow = new Map(previewRows.map((row) => [row._id, row.partyId]));

  const scope = resolveSpenderScope(spenderParty, spenderRow, authUser, preferredScope);
  const eligibleScopes = resolveSpenderScopeEligibility(spenderParty, spenderRow, authUser);

  const pressureRow = await db
    .collection<PartyStrengthPressure>("partyStrengthPressure")
    .findOne({ _id: `${countryId}_${spenderParty.sequentialId}_${upperRegionId}` });
  const pressureValue = pressureRow?.value ?? 0;
  const effectiveCost = effectivePsCost(BUILD_ORG_BASE_PS_COST, pressureValue);

  // Cash side. The paying treasury is the one belonging to the tier that pays
  // the PS, so the quote matches what the POST will actually debit.
  // Organizing a big state costs more than a small one: a point of Org is a
  // share of ITS state, so the same point buys more absolute weight where there
  // are more people. Normalized to average 1 per country, so this redistributes
  // between states without moving the overall level.
  const sizeMultiplier = await resolveOrgBuildSizeMultiplier(db, countryId, upperRegionId);
  const cashPrice = orgBuildCashPrice(countryId, scope, effectiveCost, sizeMultiplier);
  const treasuryAvailable =
    scope === "state" ? (spenderRow?.treasury ?? 0) : (spenderParty.treasury ?? 0);
  const funding = resolveOrgBuildFunding({ price: cashPrice, treasury: treasuryAvailable });
  if (!funding.ok) {
    return {
      ok: false,
      reason: "insufficient-funds",
      message:
        scope === "state"
          ? "This state party cannot afford to organize here. Build Org costs money as well as Political Strength; top up the state treasury or ask the national party for a transfer."
          : "The national party cannot afford to organize here. Build Org costs money as well as Political Strength; raise funds before building again.",
    };
  }

  return {
    ok: true,
    effectiveCost,
    pressureValue,
    cashPrice,
    sizeMultiplier,
    treasuryAvailable,
    fundedFraction: funding.fundedFraction,
    contributionUnits: ORG_BUILD_UNITS_PER_CLICK,
    projectedOrganizationUnits: ownProjection.organizationUnits,
    projectedGain: ownProjection.delta,
    dilutions: bucketResult.rows
      .filter((row) => row.id !== previewRowId && row.delta < 0)
      .map((row) => ({
        partyId: partyIdByRow.get(row.id) ?? row.id,
        loss: Math.abs(row.delta),
      })),
    scope,
    eligibleScopes,
  };
}

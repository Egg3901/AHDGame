import { errorResponse } from "@/lib/api/errors";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { crossCountryActionGuard } from "@/lib/api/crossCountryGuard";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { isNonPartyOrganizationUsRegion } from "@/lib/constants/states";
import type { OrgRegLedger, PartyStrengthPressure } from "@/lib/db/types";
import { findPartyBySequentialId, findStatePartyOrgRow } from "@/lib/db/partyLookup";
import { checkPartyPresence } from "@/lib/turn/partyOrg/presence";
import { ensureStatePartyOrgRow } from "@/lib/turn/partyOrg/ensureStatePartyOrgRow";
import { getGameState } from "@/lib/gameState";
import { spendPoliticalStrength } from "@/lib/parties/commands/spendPoliticalStrength";
import {
  canSpendOnStateParty,
  resolveSpenderScope,
  resolveSpenderScopeEligibility,
} from "@/lib/parties/access";
import {
  BUILD_ORG_BASE_PS_COST,
  effectivePsCost,
} from "@/lib/turn/politicalStrength/strengthConstants";
import {
  clampFundedFraction,
  orgBuildCashPrice,
  resolveOrgBuildFunding,
} from "@/lib/politicalStrength/buildOrgFunding";
import { chargeOrgBuildFunds } from "@/lib/parties/commands/chargeOrgBuildFunds";
import { resolveOrgBuildSizeMultiplier } from "@/lib/politicalStrength/orgBuildStateSize";
import { computeBuildOrgPreview } from "@/lib/turn/politicalStrength/computeBuildOrgPreview";
import { buildOrganizationBucket } from "@/lib/parties/commands/buildOrganizationBucket";
import { ORG_BUILD_UNITS_PER_CLICK } from "@/lib/constants/partyOrg";

interface RouteParams {
  params: Promise<{ code: string; id: string; partyId: string }>;
}

/**
 * POST /api/country/[code]/region/[id]/party/[partyId]/build-org —
 * spend PS to deposit one fixed contribution unit in the party's regional Org
 * bucket. Org% is derived from accumulated units, so new investment dilutes
 * established shares proportionally instead of directly poaching points.
 *
 * Acceptance:
 *  - PS debit + per-state pressure ladder via `spendPoliticalStrength`
 *  - One fixed contribution unit and inactivity-clock reset per successful click
 *  - Every resulting cached Org-share change is written to `orgRegLedger`
 *  - Auth: state chair / vice-chair / national chair / vice-chair / admin
 */
const buildOrgBodySchema = z.object({
  psPool: z.enum(["state", "national"]).optional(),
});

/**
 * Build Org historically accepted no request body. Parse tolerantly: an empty
 * or absent body is valid (→ no `psPool`, server default = state pool). A
 * present-but-malformed body is rejected.
 */
async function parseOptionalPsPool(
  request: Request
): Promise<{ ok: true; psPool?: "state" | "national" } | { ok: false; error: string }> {
  let text = "";
  try {
    text = await request.text();
  } catch {
    return { ok: true };
  }
  if (!text.trim()) return { ok: true };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "Invalid JSON body" };
  }
  const parsed = buildOrgBodySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid body" };
  }
  return { ok: true, psPool: parsed.data.psPool };
}

export async function POST(request: Request, { params }: RouteParams) {
  const { code, id: regionId, partyId } = await params;
  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) {
    return errorResponse(400, "Invalid country code");
  }

  const authResult = await requireAuthWithCharacter();
  if (!authResult.ok) return authResult.response;
  const authUser = authResult.user;

  // Party sequentialId is unique per country, so a foreign character's party id
  // collides onto the same-id party in this country. Block cross-country actors
  // (admins included) before any spender/auth resolution — Bug #0668.
  const crossCountry = crossCountryActionGuard(authUser.character, countryId);
  if (crossCountry) return crossCountry;

  const rateLimit = checkRateLimit(authUser.userId, 20, 60_000);
  if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

  const bodyResult = await parseOptionalPsPool(request);
  if (!bodyResult.ok) {
    return errorResponse(400, bodyResult.error);
  }
  const psPool = bodyResult.psPool;

  const upperRegionId = regionId.toUpperCase();
  const db = await getDb();

  // Resolve spender party + its state-party row. The row MAY be absent: the
  // seed deliberately omits some (Land, party) pairs that don't organize
  // there historically (e.g. CDU stays out of Bayern under the CDU/CSU Union
  // pact). Presence — not row-existence — is the real gate, so we don't bail
  // on a missing row here; we bootstrap it below once presence + auth pass.
  const spenderParty = await findPartyBySequentialId(db, partyId, countryId);
  if (!spenderParty) return errorResponse(404, "Party not found");
  // Resolve by the `{countryId, stateId, partyId}` triple with a compound-`_id`
  // fallback. A field-triple-only read here is what let Build Org poach a
  // drifted row's org from the WRONG party's balance (ticket #1256): the row
  // the party page displayed (`_id NW_1`, partyId "6" = SPD) counted as a
  // rival while SED's own numbers sat on a stale `_id NW_7`.
  let spenderRow = await findStatePartyOrgRow(db, countryId, upperRegionId, spenderParty);

  // Organizational Foothold rule (plan §"Glossary"): a party may only
  // grow Org in a state once it has at least one player or NPP / elected
  // official there. Checked LIVE rather than via the cached
  // `statePartyOrg.hasPresence` flag, which only refreshes on membership
  // events and can lag — leaving a real player/official wrongly blocked.
  const hasPresence = await checkPartyPresence(
    db,
    upperRegionId,
    String(spenderParty.sequentialId)
  );
  if (!hasPresence) {
    return errorResponse(
      400,
      "Cannot build org without presence in this state. Establish a player or elected official here first."
    );
  }

  // Reject US regions outside the party-organization jurisdiction set before
  // reaching the SSOT chokepoint. DC is supported even though it elects no
  // congressional or state offices.
  if (isNonPartyOrganizationUsRegion(countryId, upperRegionId)) {
    return errorResponse(400, "This US region does not support a party organization.");
  }

  // Auth: state chair / state vice / state campaigner / national chair /
  // national vice / national campaigner / admin. (Treasurer excluded.)
  // `canSpendOnStateParty` tolerates a null row — with no row there are no
  // state-tier officers, so a missing-row state is authorized only for
  // national-tier roles (chair / vice / campaigner) or admin.
  if (!canSpendOnStateParty(spenderParty, spenderRow, authUser)) {
    return errorResponse(
      403,
      "Only the party chair, vice chair, an assigned campaigner, or admin can build org"
    );
  }

  // Presence confirmed + authorized but no seeded row → bootstrap it at 0%
  // Org so the party can begin organizing in this state. Idempotent upsert.
  if (!spenderRow) {
    spenderRow = await ensureStatePartyOrgRow(db, {
      countryId,
      stateId: upperRegionId,
      party: spenderParty,
      hasPresence: true,
    });
  }

  const ownId = String(spenderParty.sequentialId);
  const gameState = await getGameState(db);
  const currentTurn = gameState?.currentTurn ?? 0;
  const now = new Date();

  // National-tier roles (chair / vice / campaigner) pay from the national
  // party PS pool; state-tier roles pay from the per-state PS pool. A dual-role
  // officer (national + state) may pick a pool via `psPool`. Honor an explicit
  // choice only when the spender is actually eligible for that tier; reject a
  // tampered / ineligible choice rather than silently charging the wrong pool.
  const eligibility = resolveSpenderScopeEligibility(spenderParty, spenderRow, authUser);
  if (psPool === "national" && !eligibility.national) {
    return errorResponse(
      403,
      "Spending the national pool is limited to the party's national officers. You need to be its national chair, vice chair or campaigner. Switch to the state pool, or ask a party leader to appoint you."
    );
  }
  if (psPool === "state" && !eligibility.state) {
    return errorResponse(
      403,
      "Spending a state pool is limited to that state's party officers. You need to be its state chair, vice chair or campaigner. Ask a party leader to appoint you from the party's management page."
    );
  }
  const preferred =
    psPool === "national" ? "national-targeted" : psPool === "state" ? "state" : undefined;
  const scope = resolveSpenderScope(spenderParty, spenderRow, authUser, preferred);

  // ── Cash gate (2026-09-02) ────────────────────────────────────────────────
  // Build Org costs money as well as PS, charged from the SAME tier that pays
  // the PS. Price it BEFORE the PS is spent so a click the treasury cannot fund
  // is refused for free — no PS debit and no pressure escalation. That means
  // reading the pressure ladder here rather than relying on the value
  // `spendPoliticalStrength` computes internally; the preview GET does the same
  // read, so the quote the player saw and the charge they get agree.
  const pressureRow = await db
    .collection<PartyStrengthPressure>("partyStrengthPressure")
    .findOne({ _id: `${countryId}_${spenderParty.sequentialId}_${upperRegionId}` });
  const quotedPsCost = effectivePsCost(BUILD_ORG_BASE_PS_COST, pressureRow?.value ?? 0);
  // Organizing a large state costs more than a small one — see
  // `ORG_BUILD_SIZE_MULTIPLIER_MIN`. Resolved once and reused for the charge
  // below so the gate and the debit price the click identically.
  const sizeMultiplier = await resolveOrgBuildSizeMultiplier(db, countryId, upperRegionId);
  const quotedPrice = orgBuildCashPrice(countryId, scope, quotedPsCost, sizeMultiplier);
  const payingTreasury =
    scope === "state" ? (spenderRow.treasury ?? 0) : (spenderParty.treasury ?? 0);
  const funding = resolveOrgBuildFunding({ price: quotedPrice, treasury: payingTreasury });
  if (!funding.ok) {
    return errorResponse(
      400,
      scope === "state"
        ? "This state party cannot afford to organize here. Build Org costs money as well as Political Strength; top up the state treasury or ask the national party for a transfer."
        : "The national party cannot afford to organize here. Build Org costs money as well as Political Strength; raise funds before building again."
    );
  }

  // Spend PS via the shared command (debits PS, escalates pressure, writes ledger).
  const spendResult = await spendPoliticalStrength(
    {
      countryId,
      partyId: String(spenderParty.sequentialId),
      scope,
      stateId: upperRegionId,
      baseCost: BUILD_ORG_BASE_PS_COST,
      action: "build-org",
      now,
      turn: currentTurn,
    },
    db
  );
  if (!spendResult.ok) {
    if (spendResult.reason === "insufficient-ps") {
      return errorResponse(
        400,
        `Insufficient PS: need ${spendResult.effectiveCost}, have ${spendResult.currentPoliticalStrength.toFixed(2)}`
      );
    }
    return errorResponse(400, `Spend failed: ${spendResult.reason}`);
  }

  // Charge the cash. Priced off the PS cost the spend ACTUALLY paid, so the two
  // halves of the bill always agree even if a concurrent click nudged the ladder
  // between the quote above and the debit. `chargeOrgBuildFunds` never
  // overdraws: it takes what is there and reports it.
  const chargePrice = orgBuildCashPrice(
    countryId,
    scope,
    spendResult.effectiveCost,
    sizeMultiplier
  );
  const { charged } = await chargeOrgBuildFunds(
    {
      countryId,
      partyId: String(spenderParty.sequentialId),
      scope,
      stateRowId: String(spenderRow._id),
      amount: chargePrice,
      memo: `Build Org (${upperRegionId})`,
      initiatedBy: {
        type: "character",
        id: String(authUser.character._id),
        label: authUser.character.name,
      },
      turn: currentTurn,
      now,
    },
    db
  );

  // Realized funded share. Floored at `ORG_BUILD_MIN_FUNDED_FRACTION` because the
  // PS is already spent by this point — a treasury drained by a concurrent debit
  // must still leave the click worth something rather than turning committed PS
  // into zero Org.
  const fundedFraction = chargePrice > 0 ? clampFundedFraction(charged / chargePrice) : 1;

  const bucketResult = await buildOrganizationBucket(db, {
    countryId,
    stateId: upperRegionId,
    partyId: ownId,
    stateRowId: spenderRow._id,
    currentTurn,
    now,
  });
  if (!bucketResult) {
    return errorResponse(500, "Organization bucket update failed");
  }
  const rowById = new Map(bucketResult.sourceRows.map((row) => [row._id, row]));
  const ownResult = bucketResult.rows.find((row) => row.id === spenderRow._id);
  if (!ownResult) {
    return errorResponse(500, "Organization bucket update failed");
  }

  const changedRows = bucketResult.rows.filter(
    (row) => row.id === spenderRow._id || Math.abs(row.delta) >= 0.00005
  );
  if (changedRows.length > 0) {
    await db.collection<OrgRegLedger>("orgRegLedger").insertMany(
      changedRows.map((row) => {
        const stored = rowById.get(row.id);
        const isSpender = row.id === spenderRow._id;
        return {
          _id: new ObjectId(),
          turn: currentTurn,
          countryId,
          stateId: upperRegionId,
          partyId: stored?.partyId ?? ownId,
          metric: "org" as const,
          delta: row.delta,
          value: row.organization,
          source: isSpender ? ("action" as const) : ("passive" as const),
          actorId: isSpender ? authUser.character._id : null,
          note: isSpender
            ? "action:build-org"
            : `dilution:build-org:by:${spenderParty.sequentialId}`,
          createdAt: now,
        } satisfies OrgRegLedger;
      })
    );
  }

  const dilutions = bucketResult.rows
    .filter((row) => row.id !== spenderRow._id && row.delta < 0)
    .map((row) => ({
      partyId: rowById.get(row.id)?.partyId ?? row.id,
      loss: Math.abs(row.delta),
      newOrg: row.organization,
    }));

  // Authoritative estimate for the NEXT click, computed from the just-committed
  // state via the same helper the preview GET uses. Returning it lets the client
  // update its estimate line immediately — no async refetch that could lag the
  // escalating pressure ladder during rapid building. Re-read the party so the
  // national PS pool reflects this spend's full debit.
  const refreshedParty = (await findPartyBySequentialId(db, partyId, countryId)) ?? spenderParty;
  const nextPreview = await computeBuildOrgPreview(db, {
    countryId,
    upperRegionId,
    spenderParty: refreshedParty,
    authUser,
    // Quote the NEXT click against the pool this one actually spent. Without it
    // a dual-role officer who spent the national pool gets a next-click estimate
    // priced at the state tier — half the cash, against the wrong treasury.
    preferredScope: scope,
  });

  return NextResponse.json({
    ok: true,
    psCost: spendResult.effectiveCost,
    newPS: spendResult.newPoliticalStrength,
    newPressure: spendResult.newPressure,
    cashPrice: chargePrice,
    cashCost: charged,
    fundedFraction,
    contributionUnits: ORG_BUILD_UNITS_PER_CLICK,
    organizationUnits: ownResult.organizationUnits,
    orgGain: ownResult.delta,
    newOrg: ownResult.organization,
    dilutions,
    nextPreview,
  });
}

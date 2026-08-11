import { NextResponse } from "next/server";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { crossCountryActionGuard } from "@/lib/api/crossCountryGuard";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { isNonElectoralUsRegion } from "@/lib/constants/states";
import type { OrgRegLedger, StatePartyOrg, PoliticalParty } from "@/lib/db/types";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
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
  NATIONAL_PS_CAP,
  NATIONAL_PS_ACTIVITY_RECOVERY_FRACTION,
  PRIORITY_REGION_EFFECT_BONUS,
  blendedComparisonPs,
} from "@/lib/turn/politicalStrength/strengthConstants";
import { calcUnifiedBuildOrg } from "@/lib/turn/politicalStrength/buildOrgGain";
import { isStateInPriorityRegion } from "@/lib/parties/priorityRegion";
import { resolveUnmannedDefaultCaptureMultiplier } from "@/lib/parties/unmannedDefenseShield";
import { computeBuildOrgPreview } from "@/lib/turn/politicalStrength/computeBuildOrgPreview";

interface RouteParams {
  params: Promise<{ code: string; id: string; partyId: string }>;
}

/**
 * POST /api/country/[code]/region/[id]/party/[partyId]/build-org —
 * spend PS to grow your party's Org% in this state, drawing from the
 * unaffiliated/independent pool AND poaching rivals in one click
 * (2026-06-24 unified Build Org). Per-click gain + sourcing breakdown is
 * computed by `calcUnifiedBuildOrg` from the state's current Org distribution
 * and the relative PS reserves of the spender vs each rival.
 *
 * Acceptance:
 *  - PS debit + per-state pressure ladder via `spendPoliticalStrength`
 *  - Returns 400 only when nothing can be taken (empty pool AND no rival holds
 *    any Org to poach)
 *  - Spender gain logged in `orgRegLedger` with `source: "action"`,
 *    `note: "action:build-org"`; each rival's loss logged with `source: "poach"`
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
    return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
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
    return NextResponse.json({ error: bodyResult.error }, { status: 400 });
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
  if (!spenderParty) return NextResponse.json({ error: "Party not found" }, { status: 404 });
  let spenderRow = await db.collection<StatePartyOrg>("statePartyOrg").findOne({
    countryId,
    stateId: upperRegionId,
    partyId: String(spenderParty.sequentialId),
  });

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
    return NextResponse.json(
      {
        error:
          "Cannot build org without presence in this state. Establish a player or elected official here first.",
      },
      { status: 400 }
    );
  }

  // Federal districts like DC elect no offices and host no state party
  // organization. Guard here so the region page's Build Org action returns a
  // clean 400 instead of the SSOT chokepoint throwing an uncaught 500.
  if (isNonElectoralUsRegion(countryId, upperRegionId)) {
    return NextResponse.json(
      {
        error: "This region is a federal district with no state party organization.",
      },
      { status: 400 }
    );
  }

  // Auth: state chair / state vice / state campaigner / national chair /
  // national vice / national campaigner / admin. (Treasurer excluded.)
  // `canSpendOnStateParty` tolerates a null row — with no row there are no
  // state-tier officers, so a missing-row state is authorized only for
  // national-tier roles (chair / vice / campaigner) or admin.
  if (!canSpendOnStateParty(spenderParty, spenderRow, authUser)) {
    return NextResponse.json(
      {
        error: "Only the party chair, vice chair, an assigned campaigner, or admin can build org",
      },
      { status: 403 }
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

  // Pull all parties' state-party rows in this state for the gain calculation.
  const ownId = String(spenderParty.sequentialId);
  const allStateRows = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .find({ countryId, stateId: upperRegionId })
    .toArray();

  const totalPartyOrgPct = allStateRows.reduce((s, r) => s + (r.organization ?? 0), 0);
  const rivalRows = allStateRows.filter((r) => r.partyId !== ownId && (r.organization ?? 0) > 0);
  const rivalLeadOrgPct = rivalRows.reduce((max, r) => Math.max(max, r.organization ?? 0), 0);

  // Resolve each rival party doc for (a) the unmanned-default shield (0.5 for an
  // abandoned default stronghold, else 1) and (b) its NATIONAL PS pool, which is
  // blended into the per-state strength comparison below.
  const rivalParties = rivalRows.length
    ? await db
        .collection<PoliticalParty>("politicalParties")
        .find({ countryId, sequentialId: { $in: rivalRows.map((r) => Number(r.partyId)) } })
        .toArray()
    : [];
  const partyBySeq = new Map(rivalParties.map((p) => [String(p.sequentialId), p]));
  const shieldByPartyId = new Map<string, number>();
  for (const r of rivalRows) {
    const p = partyBySeq.get(r.partyId);
    shieldByPartyId.set(r.partyId, p ? await resolveUnmannedDefaultCaptureMultiplier(db, p) : 1);
  }

  // Effective PS = state PS + a fraction of national PS, applied to spender and
  // every rival so leverage + poach weighting compare like with like.
  const ownPS = blendedComparisonPs(
    spenderRow.politicalStrength ?? 0,
    spenderParty.politicalStrength ?? 0
  );
  const rivals = rivalRows.map((r) => ({
    partyId: r.partyId,
    orgPct: r.organization ?? 0,
    ps: blendedComparisonPs(
      r.politicalStrength ?? 0,
      partyBySeq.get(r.partyId)?.politicalStrength ?? 0
    ),
    shield: shieldByPartyId.get(r.partyId) ?? 1,
  }));
  const rivalsWithPS = rivals.filter((r) => r.ps > 0);
  const avgRivalPS =
    rivalsWithPS.length > 0 ? rivalsWithPS.reduce((s, r) => s + r.ps, 0) / rivalsWithPS.length : 0;

  const breakdown = calcUnifiedBuildOrg({
    ownOrgPct: spenderRow.organization ?? 0,
    ownPS,
    totalPartyOrgPct,
    rivalLeadOrgPct,
    avgRivalPS,
    rivals,
  });

  if (breakdown.totalGain <= 0) {
    return NextResponse.json(
      {
        error:
          "Nothing to build here — the unaffiliated pool is empty and no rival holds any Org to poach.",
      },
      { status: 400 }
    );
  }

  // No per-party Org cap — the state-wide Org pool sum constraint
  // (`Σ party Org + Unaffiliated Org = 100`) is the only ceiling, enforced by
  // the conservation in `calcUnifiedBuildOrg` (each poach clamps at the rival's
  // current Org; the pool slice clamps at the unaffiliated remainder).
  //
  // Priority Region bonus: when the targeted state is in the spender's
  // priorityRegion cluster, multiply the EFFECT by `1 + PRIORITY_REGION_EFFECT_BONUS`
  // (+25%) — not the PS cost (2026-05-23 spec for #13). Scale the pool slice and
  // each rival's loss, then re-clamp so the bonus can't overdraw the pool or a
  // rival's current Org.
  const priorityBonus = isStateInPriorityRegion(spenderParty, upperRegionId)
    ? 1 + PRIORITY_REGION_EFFECT_BONUS
    : 1;
  const poolAvailablePct = Math.max(0, 100 - totalPartyOrgPct);
  const appliedPoolGain = Math.min(breakdown.poolGain * priorityBonus, poolAvailablePct);
  const rivalOrgById = new Map(rivalRows.map((r) => [r.partyId, r.organization ?? 0]));
  const appliedPoaches = breakdown.rivalPoaches
    .map((p) => ({
      partyId: p.partyId,
      loss: Math.min(p.loss * priorityBonus, rivalOrgById.get(p.partyId) ?? 0),
    }))
    .filter((p) => p.loss > 0);
  const actualGain = appliedPoolGain + appliedPoaches.reduce((s, p) => s + p.loss, 0);

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
    return NextResponse.json(
      { error: "You are not authorized to spend from the national PS pool." },
      { status: 403 }
    );
  }
  if (psPool === "state" && !eligibility.state) {
    return NextResponse.json(
      { error: "You are not authorized to spend from the state PS pool." },
      { status: 403 }
    );
  }
  const preferred =
    psPool === "national" ? "national-targeted" : psPool === "state" ? "state" : undefined;
  const scope = resolveSpenderScope(spenderParty, spenderRow, authUser, preferred);

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
      return NextResponse.json(
        {
          error: `Insufficient PS: need ${spendResult.effectiveCost}, have ${spendResult.currentPoliticalStrength.toFixed(2)}`,
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: `Spend failed: ${spendResult.reason}` }, { status: 400 });
  }

  // National PS activity recovery (2026-06-28, ticket #0762): refund a fraction
  // of the effective cost back to the national party's PS pool so treasury-poor
  // parties recover PS through active org-building rather than pure investment.
  // Capped at NATIONAL_PS_CAP via an update pipeline to prevent overshoot.
  if (scope === "national-targeted") {
    const recoveryPS = Math.ceil(
      spendResult.effectiveCost * NATIONAL_PS_ACTIVITY_RECOVERY_FRACTION
    );
    await db
      .collection<PoliticalParty>("politicalParties")
      .updateOne({ countryId, sequentialId: spenderParty.sequentialId }, [
        {
          $set: {
            politicalStrength: {
              $min: [NATIONAL_PS_CAP, { $add: ["$politicalStrength", recoveryPS] }],
            },
          },
        },
      ]);
  }

  // Apply Org gain to spender (round to 2 decimals to match prior precision).
  const newOwnOrg = Math.round(((spenderRow.organization ?? 0) + actualGain) * 100) / 100;
  await db
    .collection<StatePartyOrg>("statePartyOrg")
    .updateOne({ _id: spenderRow._id }, { $set: { organization: newOwnOrg, updatedAt: now } });

  // Apply each rival's poach loss + write a per-rival poach ledger row.
  const poachOutcomes: Array<{
    partyId: string;
    loss: number;
    newOrg: number;
    partyName?: string;
    abbreviation?: string;
  }> = [];
  for (const poach of appliedPoaches) {
    const rivalRow = rivalRows.find((r) => r.partyId === poach.partyId);
    if (!rivalRow) continue;
    const rivalParty = partyBySeq.get(poach.partyId);
    const rivalNewOrg =
      Math.round(Math.max(0, (rivalRow.organization ?? 0) - poach.loss) * 100) / 100;
    await db
      .collection<StatePartyOrg>("statePartyOrg")
      .updateOne({ _id: rivalRow._id }, { $set: { organization: rivalNewOrg, updatedAt: now } });
    await db.collection<OrgRegLedger>("orgRegLedger").insertOne({
      _id: new ObjectId(),
      turn: currentTurn,
      countryId,
      stateId: upperRegionId,
      partyId: poach.partyId,
      metric: "org",
      delta: -poach.loss,
      value: rivalNewOrg,
      source: "poach",
      actorId: authUser.character._id,
      note: `poach:build-org:from:${spenderParty.sequentialId}`,
      createdAt: now,
    });
    poachOutcomes.push({
      partyId: poach.partyId,
      loss: poach.loss,
      newOrg: rivalNewOrg,
      ...(rivalParty ? { partyName: rivalParty.name, abbreviation: rivalParty.abbreviation } : {}),
    });
  }

  // Log the spender's Org gain in orgRegLedger.
  await db.collection<OrgRegLedger>("orgRegLedger").insertOne({
    _id: new ObjectId(),
    turn: currentTurn,
    countryId,
    stateId: upperRegionId,
    partyId: ownId,
    metric: "org",
    delta: actualGain,
    value: newOwnOrg,
    source: "action",
    actorId: authUser.character._id,
    note: "action:build-org",
    createdAt: now,
  });

  // Authoritative estimate for the NEXT click, computed from the just-committed
  // state via the same helper the preview GET uses. Returning it lets the client
  // update its estimate line immediately — no async refetch that could lag the
  // escalating pressure ladder during rapid building. Re-read the party so the
  // national PS pool reflects this spend's debit + activity recovery.
  const refreshedParty = (await findPartyBySequentialId(db, partyId, countryId)) ?? spenderParty;
  const nextPreview = await computeBuildOrgPreview(db, {
    countryId,
    upperRegionId,
    spenderParty: refreshedParty,
    authUser,
  });

  return NextResponse.json({
    ok: true,
    psCost: spendResult.effectiveCost,
    newPS: spendResult.newPoliticalStrength,
    newPressure: spendResult.newPressure,
    orgGain: actualGain,
    newOrg: newOwnOrg,
    poaches: poachOutcomes,
    factors: breakdown.factors,
    priorityRegionBonusApplied: priorityBonus > 1,
    nextPreview,
  });
}

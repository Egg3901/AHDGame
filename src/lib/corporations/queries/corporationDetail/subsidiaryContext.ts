import { ObjectId, type Db } from "mongodb";
import type { Bond, Corporation } from "@/lib/db/types";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import {
  acquirerOwnershipPercent,
  getControllingCorporateParent,
  HOSTILE_TAKEOVER_OWNERSHIP_THRESHOLD_PERCENT,
  SUBSIDIARY_OWNERSHIP_THRESHOLD_PERCENT,
} from "@/lib/corporations/corporateOwnership";
import { canActOnCorporationAsParent } from "@/lib/corporations/subsidiaries/authorization";
import {
  activeParentDividendFloorPct,
  isEligibleAsSubsidiary,
  isEligibleAsSubsidiaryParent,
  isFormalizedSubsidiary as isFormalizedSubsidiaryHelper,
} from "@/lib/corporations/subsidiaries/helpers";
import {
  corpLiquidCapitalToAnchor,
  fxRateForCorpFromMap,
  loadValuationFxRates,
} from "@/lib/currency/corporationCapital";
import {
  corporationWithReservedHoldings,
  loadReservedPositionsPlacedBy,
} from "@/lib/corporations/reservedCorporateHoldings";
import { MAX_DIVIDEND_RATE } from "@/lib/constants/corporations";

async function buildHostileTakeoverEligibility(
  db: Db,
  corporation: Corporation,
  viewerUserId: string | null | undefined
) {
  if (!viewerUserId || corporation.countryOwnerId) return null;

  const myCorps = await db
    .collection<Corporation>("corporations")
    .find({
      userId: new ObjectId(viewerUserId),
      ceoVacant: { $ne: true },
      countryOwnerId: { $exists: false },
    })
    .project({ _id: 1 })
    .toArray();

  // Valuation map, not the settlement map: this value is DISPLAYED and RANKED.
  // The settlement map leaves the six bloc currencies (PLZ/CSK/HUF/YUD/BGL/ROL,
  // 102 corps) missing on purpose, which converted them at 1.0. See
  // corporationCapital.ts.
  const fxByCurrency = await loadValuationFxRates(db);
  for (const mc of myCorps) {
    const acqPct = acquirerOwnershipPercent(mc._id, corporation);
    if (acqPct > HOSTILE_TAKEOVER_OWNERSHIP_THRESHOLD_PERCENT) {
      const [outstandingBonds, parentCorp] = await Promise.all([
        db
          .collection<Bond>("bonds")
          .find({ corporationId: corporation._id, matured: false })
          .toArray(),
        db.collection<Corporation>("corporations").findOne({ _id: mc._id }),
      ]);
      const outstandingBondDebt = outstandingBonds.reduce((sum, b) => sum + b.totalIssued, 0);
      const parentFx = parentCorp ? fxRateForCorpFromMap(parentCorp, fxByCurrency) : 1;
      const parentLiquidAnchor = parentCorp
        ? corpLiquidCapitalToAnchor(parentCorp.liquidCapital, parentCorp, parentFx)
        : 0;
      const parentCurrency = parentCorp
        ? (COUNTRY_CURRENCY_MAP[parentCorp.countryId] ?? "USD")
        : "USD";

      return {
        parentCorporationId: mc._id.toString(),
        ownershipPct: Math.round(acqPct * 100) / 100,
        outstandingBonds: outstandingBonds.length,
        outstandingBondDebt,
        parentLiquidCapital: parentLiquidAnchor,
        parentLiquidCurrencyCode: parentCurrency,
      };
    }
  }

  return null;
}

export interface ParentCorporationPayload {
  _id: string;
  sequentialId?: number;
  name: string;
  ownershipPct: number;
}

export interface SubsidiaryPayload {
  _id: string;
  sequentialId?: number;
  name: string;
  ownershipPct: number;
}

export interface SubsidiaryContextResult {
  parentCorporationPayload: ParentCorporationPayload | null;
  subsidiariesPayload: SubsidiaryPayload[];
  subsidiaryCorporationsEnabled: boolean;
  isFormalizedSub: boolean;
  activeFloorPct: number;
  canManageAsParent: boolean;
  canFormalizeAsSubsidiary: boolean;
  canSpinOff: boolean;
  hostileTakeoverEligibility: Awaited<ReturnType<typeof buildHostileTakeoverEligibility>>;
}

/**
 * Parent / subsidiary / takeover / spin-off context for the detail view (#587).
 *
 * The parent-corp lookup, the subsidiary-candidates query, and the hostile-
 * takeover eligibility build are independent, so they fan out in one round
 * trip instead of three sequential awaits. Control is VOTING power everywhere
 * (dual-class corps carry superShareMultiplier through the same helper the
 * takeover path uses).
 */
export async function loadSubsidiaryContext(
  db: Db,
  corporationForControl: Corporation,
  corporation: Corporation,
  viewerUserId: string | null | undefined
): Promise<SubsidiaryContextResult> {
  const controllingParent = getControllingCorporateParent(corporationForControl);
  // The parent-corp lookup, the subsidiary-candidates query, and the hostile-
  // takeover eligibility build are independent — fan them out in one round
  // trip instead of three sequential awaits.
  const [pDoc, subsidiaryCandidates, hostileTakeoverEligibility, reservedPlacedByThisCorp] =
    await Promise.all([
      controllingParent
        ? db
            .collection<Corporation>("corporations")
            .findOne(
              { _id: controllingParent.corporationId },
              { projection: { _id: 1, name: 1, sequentialId: 1 } }
            )
        : Promise.resolve(null),
      db
        .collection<Corporation>("corporations")
        .find({
          shareholders: {
            $elemMatch: {
              corporationId: corporation._id,
              shares: { $gt: 0 },
            },
          },
        })
        // superShareMultiplier is required: control is voting power, and a
        // dual-class corp's voting total differs from its share total.
        .project<
          Pick<
            Corporation,
            | "_id"
            | "name"
            | "sequentialId"
            | "totalShares"
            | "shareholders"
            | "superShareMultiplier"
          >
        >({
          _id: 1,
          name: 1,
          sequentialId: 1,
          totalShares: 1,
          shareholders: 1,
          superShareMultiplier: 1,
        })
        .toArray(),
      buildHostileTakeoverEligibility(db, corporation, viewerUserId),
      loadReservedPositionsPlacedBy(db, corporation._id),
    ]);

  let parentCorporationPayload: ParentCorporationPayload | null = null;
  if (controllingParent && pDoc) {
    parentCorporationPayload = {
      _id: pDoc._id.toString(),
      sequentialId: pDoc.sequentialId,
      name: pDoc.name,
      ownershipPct: controllingParent.ownershipPct,
    };
  }

  const subsidiariesPayload: SubsidiaryPayload[] = [];
  const reservedSharesByTarget = new Map(
    reservedPlacedByThisCorp.map((r) => [r.targetCorpId.toString(), r.shares])
  );
  const candidateIds = new Set(subsidiaryCandidates.map((s) => s._id.toString()));
  const missingReservedIds = reservedPlacedByThisCorp
    .map((r) => r.targetCorpId)
    .filter((id) => !candidateIds.has(id.toString()));
  if (missingReservedIds.length > 0) {
    const extraSubs = await db
      .collection<Corporation>("corporations")
      .find({ _id: { $in: missingReservedIds } })
      .project<
        Pick<
          Corporation,
          "_id" | "name" | "sequentialId" | "totalShares" | "shareholders" | "superShareMultiplier"
        >
      >({
        _id: 1,
        name: 1,
        sequentialId: 1,
        totalShares: 1,
        shareholders: 1,
        superShareMultiplier: 1,
      })
      .toArray();
    subsidiaryCandidates.push(...extraSubs);
  }
  for (const sub of subsidiaryCandidates) {
    const reservedShares = reservedSharesByTarget.get(sub._id.toString()) ?? 0;
    const subForControl = corporationWithReservedHoldings(sub as Corporation, [
      { corporationId: corporation._id, shares: reservedShares },
    ]);
    const total = subForControl.totalShares ?? 0;
    if (total <= 0) continue;
    // Control is VOTING power everywhere else in the subsidiary model
    // (getControllingCorporateParent, the formalize guard, the hostile
    // threshold). Listing by raw share percent made a dual-class corp appear
    // in, or vanish from, the parent's subsidiary list while the actions on it
    // disagreed. Same helper the takeover path uses.
    const pct = acquirerOwnershipPercent(corporation._id, subForControl);
    if (pct > SUBSIDIARY_OWNERSHIP_THRESHOLD_PERCENT) {
      subsidiariesPayload.push({
        _id: sub._id.toString(),
        sequentialId: sub.sequentialId,
        name: sub.name,
        ownershipPct: Math.round(pct * 100) / 100,
      });
    }
  }

  // Subsidiary corporations (feature-gated): derive management/formalization
  // eligibility for the viewer + honor the parent dividend floor. Read the flag
  // via the in-scope db (this query already holds a connection).
  const subsidiaryGs = await db
    .collection<{ _id: string; subsidiaryCorporationsEnabled?: boolean }>("gameState")
    .findOne({ _id: "current" }, { projection: { subsidiaryCorporationsEnabled: 1 } });
  const subsidiaryCorporationsEnabled = subsidiaryGs?.subsidiaryCorporationsEnabled === true;
  const isFormalizedSub = isFormalizedSubsidiaryHelper(corporation, controllingParent);
  const activeFloorPct = activeParentDividendFloorPct({
    enabled: subsidiaryCorporationsEnabled,
    parentDividendFloorPct: corporation.parentDividendFloorPct,
    parentDividendFloorSetByCorpId: corporation.parentDividendFloorSetByCorpId,
    controllingParent,
    maxRate: MAX_DIVIDEND_RATE,
  });
  let canManageAsParent = false;
  let canFormalizeAsSubsidiary = false;
  // Viewer (as CEO of this corp) may spin off a subsidiary when the corp is
  // eligible to act as a parent. The command re-checks cooldown + sector count.
  const canSpinOff =
    subsidiaryCorporationsEnabled &&
    !!viewerUserId &&
    corporation.ceoVacant !== true &&
    corporation.userId?.toString() === viewerUserId &&
    isEligibleAsSubsidiaryParent(corporation);
  if (subsidiaryCorporationsEnabled && viewerUserId) {
    canManageAsParent = await canActOnCorporationAsParent(
      db,
      new ObjectId(viewerUserId),
      corporation
    );
    // Viewer may formalize iff they are CEO of the corp controlling >50% of this
    // target, both corps are eligible, and it is not already formalized. Cycle
    // safety is enforced authoritatively by the formalize command.
    if (
      !isFormalizedSub &&
      controllingParent != null &&
      pDoc != null &&
      isEligibleAsSubsidiary(corporation) &&
      corporation.subsidiaryFormalizedAtTurn == null
    ) {
      const parentDoc = await db.collection<Corporation>("corporations").findOne(
        { _id: controllingParent.corporationId },
        {
          projection: {
            userId: 1,
            ceoVacant: 1,
            countryOwnerId: 1,
            subsidiaryFormalizedAtTurn: 1,
          },
        }
      );
      canFormalizeAsSubsidiary =
        parentDoc != null &&
        parentDoc.ceoVacant !== true &&
        parentDoc.userId?.toString() === viewerUserId &&
        isEligibleAsSubsidiaryParent(parentDoc);
    }
  }

  return {
    parentCorporationPayload,
    subsidiariesPayload,
    subsidiaryCorporationsEnabled,
    isFormalizedSub,
    activeFloorPct,
    canManageAsParent,
    canFormalizeAsSubsidiary,
    canSpinOff,
    hostileTakeoverEligibility,
  };
}

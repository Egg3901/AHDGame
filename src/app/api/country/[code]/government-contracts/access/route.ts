import { maxTechTierForPreset } from "@/lib/admin/seed/seedMilitaryUnits";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { ObjectId } from "mongodb";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { lotPrice } from "@/lib/military/arsenal";
import { militaryPriceAnchor } from "@/lib/military/procurement";
import type { Corporation, CorporateSector, FederalBudget } from "@/lib/db/types";
import { contractContext, contractRouteError, privateJson } from "@/lib/governmentContracts/api";
import { managementAuthority } from "@/lib/governmentContracts/authority";
import { getResourceContractAuthority } from "@/lib/extraction/contractAuthority";
import { loadContractIssuanceSettings } from "@/lib/extraction/featureFlag";
import { defenceContractWindow } from "@/lib/military/defenceContractLimits";
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const { db, countryId, turn, game } = await contractContext(code);
    const user = await getAuthUserWithCharacter();
    const states = await db
      .collection("stateResourceCapacity")
      .find({ countryId }, { projection: { stateId: 1, resources: 1 } })
      .toArray();
    const settings = await loadContractIssuanceSettings(db);
    const authority = await getResourceContractAuthority(db, countryId);
    const defence =
      !!user &&
      !!(await managementAuthority(
        db,
        countryId,
        { type: "defence", component: "ground", lots: 1, grade: 0, maximumPricePerLot: 1 },
        user
      ));
    const national =
      !!user &&
      settings.contractIssuanceEnabled &&
      authority !== "state" &&
      !!(await managementAuthority(
        db,
        countryId,
        {
          type: "extraction",
          stateId: "",
          resource: "oil",
          share: 0.01,
          termTurns: 24,
          royaltyRatePerTurn: 0,
          minimumSigningFeeAnchor: 0,
        },
        user,
        "national"
      ));
    const regional =
      user && settings.contractIssuanceEnabled && authority !== "national"
        ? await Promise.all(
            states.map(async (s) => ({
              stateId: s.stateId,
              allowed: !!(await managementAuthority(
                db,
                countryId,
                {
                  type: "extraction",
                  stateId: s.stateId,
                  resource: "oil",
                  share: 0.01,
                  termTurns: 24,
                  royaltyRatePerTurn: 0,
                  minimumSigningFeeAnchor: 0,
                },
                user,
                "state"
              )),
            }))
          )
        : [];
    const regionalStateIds = new Set(regional.filter((s) => s.allowed).map((s) => s.stateId));
    const budget = defence
      ? await db
          .collection<FederalBudget>("federalBudget")
          .findOne(
            { countryId },
            { projection: { gdp: 1, militaryPriceBaselineGdp: 1, defenseAppropriation: 1 } }
          )
      : null;
    const defenceAnchorPrice = budget
      ? lotPrice(countryId, militaryPriceAnchor(budget.gdp, budget.militaryPriceBaselineGdp))
      : null;
    const corps = user
      ? await db
          .collection<Corporation>("corporations")
          .find(
            { userId: new ObjectId(user.userId), ceoVacant: { $ne: true } },
            { projection: { name: 1, countryId: 1, type: 1, sequentialId: 1 } }
          )
          .toArray()
      : [];
    const sectors = corps.length
      ? await db
          .collection<CorporateSector>("corporateSectors")
          .find(
            { corporationId: { $in: corps.map((c) => c._id) } },
            { projection: { corporationId: 1, stateId: 1, sectorType: 1, strategyId: 1 } }
          )
          .toArray()
      : [];
    return privateJson({
      currentTurn: turn,
      defence,
      defenceAnchorPrice,
      maximumGrade: maxTechTierForPreset(game?.preset ?? DEFAULT_SEED_PRESET),
      uncommittedAppropriation: budget
        ? Math.max(
            0,
            (budget.defenseAppropriation?.balance ?? 0) -
              (budget.defenseAppropriation?.encumbered ?? 0)
          )
        : null,
      nationalExtraction: national,
      extractionEnabled: settings.contractIssuanceEnabled,
      regionalExtraction: regionalStateIds.size > 0,
      window: defenceContractWindow(countryId, turn),
      states: states
        .filter((s) => national || regionalStateIds.has(s.stateId))
        .map((s) => ({
          stateId: s.stateId,
          resources: Object.keys(s.resources ?? {}).filter((r) => s.resources[r] > 0),
        })),
      corporations: corps.map((c) => ({
        _id: c._id.toHexString(),
        name: c.name,
        countryId: c.countryId,
        type: c.type,
        sectors: sectors
          .filter((s) => s.corporationId.equals(c._id))
          .map((s) => ({
            _id: s._id.toHexString(),
            stateId: s.stateId,
            type: s.sectorType,
            strategyId: s.strategyId,
          })),
      })),
    });
  } catch (e) {
    return contractRouteError(e, request);
  }
}

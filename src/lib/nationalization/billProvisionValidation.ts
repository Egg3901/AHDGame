import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type {
  Corporation,
  NationalizeProvision,
  PrivatizeProvision,
  DesignateStrategicSectorProvision,
} from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { CORPORATION_TYPES, type CorporationType } from "@/lib/constants/corporations";
import { CARVE_FRACTION_MIN, CARVE_FRACTION_MAX } from "./constants";
import { isStateOwned } from "./nationalCorporation";

type NatProvision = NationalizeProvision | PrivatizeProvision | DesignateStrategicSectorProvision;

export type ValidatedNatProvisions =
  { ok: true; provisions: NatProvision[] } | { ok: false; status: number; error: string };

const fail = (error: string, status = 400): ValidatedNatProvisions => ({
  ok: false,
  status,
  error,
});

/**
 * Validate the nationalization provisions of a "state ownership" bill (spec §9/§13).
 * Legislative reach is full (any corp), but jurisdiction is same-country (the
 * dispatch handler is country-scoped). Converts string ids → ObjectId. The caller
 * guarantees the bill category is a nationalization category and that no other
 * provision kinds are mixed in.
 */
export async function validateNationalizationProvisions(
  db: Db,
  rawProvisions: unknown[],
  countryId: CountryId
): Promise<ValidatedNatProvisions> {
  if (!Array.isArray(rawProvisions) || rawProvisions.length === 0) {
    return fail("A state-ownership bill must contain at least one provision.");
  }

  const corps = db.collection<Corporation>("corporations");
  const out: NatProvision[] = [];

  for (const raw of rawProvisions) {
    const p = raw as { type?: string };

    if (p.type === "nationalize") {
      const r = raw as {
        targetCorporationId?: string;
        targetSectorType?: string;
        sectorCarveFraction?: number;
        sectorScope?: string;
      };
      const hasCorp = !!r.targetCorporationId;
      const hasSectorType = !!r.targetSectorType;
      if (hasCorp === hasSectorType) {
        return fail(
          "Each nationalize provision needs exactly one target (a corporation or a sector type)."
        );
      }
      if (hasCorp) {
        if (!ObjectId.isValid(r.targetCorporationId!)) return fail("Invalid corporation target.");
        const corp = await corps.findOne({ _id: new ObjectId(r.targetCorporationId!) });
        if (!corp) return fail("Target corporation not found.");
        if (corp.countryId !== countryId) return fail("Target corporation is in another country.");
        if (isStateOwned(corp)) return fail("That corporation is already state-owned.");
        out.push({ type: "nationalize", targetCorporationId: corp._id });
      } else {
        if (!CORPORATION_TYPES.includes(r.targetSectorType as CorporationType)) {
          return fail("Invalid sector type to nationalize.");
        }
        const fraction = r.sectorCarveFraction ?? 1;
        if (!(fraction > 0 && fraction <= 1)) return fail("Sector carve fraction must be 0–100%.");
        const scope = r.sectorScope ?? "all";
        if (!["all", "corporations", "unowned", "npp_unowned"].includes(scope)) {
          return fail("Invalid sector nationalization scope.");
        }
        out.push({
          type: "nationalize",
          targetSectorType: r.targetSectorType as CorporationType,
          sectorCarveFraction: fraction,
          sectorScope: scope as "all" | "corporations" | "unowned" | "npp_unowned",
        });
      }
      continue;
    }

    if (p.type === "designate_strategic_sector") {
      const r = raw as { sectorType?: string };
      if (!r.sectorType || !CORPORATION_TYPES.includes(r.sectorType as CorporationType)) {
        return fail("Invalid sector type for strategic designation.");
      }
      out.push({
        type: "designate_strategic_sector",
        sectorType: r.sectorType as CorporationType,
      });
      continue;
    }

    if (p.type === "privatize") {
      const r = raw as {
        sourceNationalCorporationId?: string;
        selections?: { sectorId?: string; carveFraction?: number }[];
        newCorpName?: string;
        goldenSharePercent?: number;
        method?: "ipo" | "auction";
        reservePrice?: number;
      };
      if (!r.sourceNationalCorporationId || !ObjectId.isValid(r.sourceNationalCorporationId)) {
        return fail("Invalid source National Corporation.");
      }
      const source = await corps.findOne({
        _id: new ObjectId(r.sourceNationalCorporationId),
        countryOwnerId: countryId,
      });
      if (!source || !isStateOwned(source)) {
        return fail("Source must be a National Corporation of this country.");
      }
      if (!Array.isArray(r.selections) || r.selections.length === 0) {
        return fail("Privatize provisions need at least one sector selection.");
      }
      const selections: { sectorId: ObjectId; carveFraction: number }[] = [];
      const seen = new Set<string>();
      for (const sel of r.selections) {
        if (!sel.sectorId || !ObjectId.isValid(sel.sectorId)) {
          return fail("Invalid sector in selection.");
        }
        if (seen.has(sel.sectorId)) return fail("Duplicate sector in selection.");
        seen.add(sel.sectorId);
        const f = Number(sel.carveFraction);
        if (!(f >= CARVE_FRACTION_MIN && f <= CARVE_FRACTION_MAX)) {
          return fail(
            `Carve fraction must be between ${CARVE_FRACTION_MIN} and ${CARVE_FRACTION_MAX}.`
          );
        }
        selections.push({ sectorId: new ObjectId(sel.sectorId), carveFraction: f });
      }
      const name = String(r.newCorpName ?? "").trim();
      if (name.length < 2) return fail("New corporation name is too short.");
      const golden = Math.max(0, Math.min(1, Number(r.goldenSharePercent ?? 0)));
      const method = r.method === "auction" ? "auction" : "ipo";
      out.push({
        type: "privatize",
        sourceNationalCorporationId: source._id,
        selections,
        newCorpName: name,
        goldenSharePercent: golden,
        method,
        ...(method === "auction" && typeof r.reservePrice === "number" && r.reservePrice > 0
          ? { reservePrice: r.reservePrice }
          : {}),
      });
      continue;
    }

    return fail("A state-ownership bill may only contain nationalization provisions.");
  }

  return { ok: true, provisions: out };
}

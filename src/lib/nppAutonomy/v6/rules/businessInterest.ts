/**
 * NPP engine 6.8: an NPP's own business stakes pull its vote (v6).
 *
 * Below v6 an NPP votes on a bill that subsidises, protects or nationalises a
 * sector exactly as it would if it owned nothing: the "donors" force only
 * echoes its ideology. At v6 an NPP that runs or holds a company weighs what
 * the bill does to that company's sector, the way a legislator with business
 * interests does. This is also the lever players get: a sector bill can win
 * the votes of the NPPs invested in that sector.
 *
 * Pure. The caller resolves each NPP's stakes from corporations it runs (CEO)
 * or holds (at least `HOLDING_MIN_FRACTION` of the shares).
 */
import type { BillProvision } from "@/lib/db/types/legislation";

/** Stake weight for running a company in the sector. */
export const CEO_STAKE = 1;
/** Stake weight for a meaningful shareholding. */
export const HOLDER_STAKE = 0.5;
/** Smallest share of a company that counts as a stake. */
export const HOLDING_MIN_FRACTION = 0.01;
/** Force per unit of stake-weighted effect, and the cap either way. */
export const BUSINESS_INTEREST_FORCE = 40;

export interface NppBusinessStakes {
  /** Stake weight per operating sector type (max over the NPP's companies). */
  sectors: ReadonlyMap<string, number>;
  /** Stake weight per corporation id. */
  corporations: ReadonlyMap<string, number>;
}

/** Signed effect of one provision on a holder, in [-1, 1] times stake weight. */
function provisionEffect(provision: BillProvision, stakes: NppBusinessStakes): number {
  const sector = (type: string | undefined) => (type ? (stakes.sectors.get(type) ?? 0) : 0);
  const anySector = () => Math.max(0, ...stakes.sectors.values());
  switch (provision.type) {
    case "subsidy":
      return provision.scopeType === "sector"
        ? sector(provision.targetSectorType)
        : 0.5 * anySector();
    case "end_subsidy":
      return provision.scopeType === "sector"
        ? -sector(provision.targetSectorType)
        : -0.5 * anySector();
    case "tariff":
      if (provision.scopeType === "sector") return sector(provision.targetSectorType);
      if (provision.scopeType === "corporation" && provision.targetCorporationId) {
        return -(stakes.corporations.get(provision.targetCorporationId.toString()) ?? 0);
      }
      return 0;
    case "nationalize": {
      const corp = provision.targetCorporationId
        ? (stakes.corporations.get(provision.targetCorporationId.toString()) ?? 0)
        : 0;
      return -Math.max(corp, sector(provision.targetSectorType));
    }
    default:
      return 0;
  }
}

/** Business-interest force for one NPP on one bill, in [-40, 40]. */
export function businessInterestForce(
  provisions: readonly BillProvision[] | undefined,
  stakes: NppBusinessStakes | undefined
): number {
  if (!stakes || !provisions || provisions.length === 0) return 0;
  if (stakes.sectors.size === 0 && stakes.corporations.size === 0) return 0;
  let effect = 0;
  for (const provision of provisions) effect += provisionEffect(provision, stakes);
  const force = effect * BUSINESS_INTEREST_FORCE;
  return Math.max(-BUSINESS_INTEREST_FORCE, Math.min(BUSINESS_INTEREST_FORCE, force));
}

/** Whether a bill carries any provision this force reads. */
export function hasBusinessProvision(provisions: readonly BillProvision[] | undefined): boolean {
  return (provisions ?? []).some(
    (p) =>
      p.type === "subsidy" ||
      p.type === "end_subsidy" ||
      p.type === "tariff" ||
      p.type === "nationalize"
  );
}

/**
 * Stakes per NPP from company rows: CEO companies at full weight, holdings of
 * at least HOLDING_MIN_FRACTION at holder weight, each spread to the
 * company's operating sector types.
 */
export function buildNppBusinessStakes(
  corporations: ReadonlyArray<{
    _id: { toString(): string };
    ceoId?: { toString(): string } | null;
    totalShares?: number;
    shareholders?: ReadonlyArray<{ nppId?: { toString(): string } | null; shares?: number }>;
  }>,
  sectorTypesByCorporation: ReadonlyMap<string, readonly string[]>,
  nppIds: ReadonlySet<string>
): Map<string, NppBusinessStakes> {
  const out = new Map<
    string,
    { sectors: Map<string, number>; corporations: Map<string, number> }
  >();
  const add = (nppId: string, corpId: string, weight: number) => {
    let entry = out.get(nppId);
    if (!entry) {
      entry = { sectors: new Map(), corporations: new Map() };
      out.set(nppId, entry);
    }
    entry.corporations.set(corpId, Math.max(entry.corporations.get(corpId) ?? 0, weight));
    for (const type of sectorTypesByCorporation.get(corpId) ?? []) {
      entry.sectors.set(type, Math.max(entry.sectors.get(type) ?? 0, weight));
    }
  };
  for (const corp of corporations) {
    const corpId = corp._id.toString();
    const ceo = corp.ceoId?.toString();
    if (ceo && nppIds.has(ceo)) add(ceo, corpId, CEO_STAKE);
    const total = corp.totalShares ?? 0;
    if (total <= 0) continue;
    for (const holder of corp.shareholders ?? []) {
      const id = holder.nppId?.toString();
      if (!id || !nppIds.has(id)) continue;
      if ((holder.shares ?? 0) / total >= HOLDING_MIN_FRACTION) add(id, corpId, HOLDER_STAKE);
    }
  }
  return out;
}

/**
 * Engine 6.13.1: the forecast line that makes a business-interest vote visible
 * on the NPP's profile, so players and opponents can see the conflict.
 */
export function businessInterestLabel(force: number): string {
  return force > 0
    ? "Own business interest: the bill helps a company this NPP runs or holds - pushes FOR"
    : "Own business interest: the bill hurts a company this NPP runs or holds - pushes AGAINST";
}

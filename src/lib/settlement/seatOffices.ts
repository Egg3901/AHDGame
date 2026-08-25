/**
 * Which offices carry each delegation, and who holds them.
 *
 * The forward counterpart to `seatResolution.ts`. That module answers
 * "which seat may this character act for", walking character → seat; this one
 * walks seat → offices → holder so the delegation blocks can name them.
 *
 * They MUST agree on who holds an office, so both read the same constants
 * (`FOREIGN_AFFAIRS_POSITION_BY_COUNTRY`, `DEFENSE_POSITION_BY_COUNTRY`, and
 * the head-of-government resolver) and both treat a null `characterId` as
 * unheld. A panel that named a holder the command would refuse is worse than a
 * panel that named nobody.
 */
import type { Db, ObjectId } from "mongodb";
import { SETTLEMENT_SEATS, type SettlementSeatKey } from "@/lib/constants/settlementCrisis";
import { FOREIGN_AFFAIRS_POSITION_BY_COUNTRY } from "@/lib/constants/internationalOrganizations";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getCharactersCollection } from "@/lib/db/collections/characters";
import { getHeadOfGovernmentCharacterId } from "@/lib/api/headOfGovernment";
import type { SettlementSeatRole } from "./seatResolution";

export interface SettlementSeatOffice {
  role: SettlementSeatRole;
  /** The country's own name for the office — "Premier", not "Head of Government". */
  title: string;
  /** The holder's name, or null when the office is vacant or NPP-held. */
  holder: string | null;
}

/** All three offices for every seat, head of government first. */
export type SettlementSeatOffices = Record<SettlementSeatKey, SettlementSeatOffice[]>;

const SEAT_COUNTRIES: readonly SettlementSeatKey[] = SETTLEMENT_SEATS.map((s) => s.id);

/**
 * The foreign-affairs seat for a country: its position id and display title.
 *
 * The title comes off the country's OWN roster rather than a shared label,
 * because the four seats do not share one — Washington's is a Secretary of
 * State and London's a Foreign Secretary.
 */
function foreignMinisterOffice(seatId: SettlementSeatKey): {
  positionId: string | null;
  title: string;
} {
  const positionId = FOREIGN_AFFAIRS_POSITION_BY_COUNTRY[seatId as CountryId] ?? null;
  if (!positionId) return { positionId: null, title: "Foreign Minister" };
  const def = getCabinetPositions(seatId).find((p) => p.id === positionId);
  return { positionId, title: def?.name ?? "Foreign Minister" };
}

function defenseMinisterOffice(seatId: SettlementSeatKey): {
  positionId: string | null;
  title: string;
} {
  const positionId = DEFENSE_POSITION_BY_COUNTRY[seatId as CountryId] ?? null;
  if (!positionId) return { positionId: null, title: "Defence Minister" };
  const def = getCabinetPositions(seatId).find((p) => p.id === positionId);
  return { positionId, title: def?.name ?? "Defence Minister" };
}

/**
 * Resolve all three offices of all four delegations.
 *
 * Four head-of-government lookups (each is a request-cached `getCountryState`
 * plus one findOne) and two batched queries, on the dossier's load path.
 */
export async function resolveSeatOffices(db: Db): Promise<SettlementSeatOffices> {
  // Deliberately the shared resolver rather than a local reimplementation: it
  // is what carries the presidential-vs-parliamentary split, and RU and DD ride
  // the non-presidential branch through `governmentFormations` exactly as a
  // parliamentary PM does.
  const headIds = await Promise.all(
    SEAT_COUNTRIES.map((seatId) => getHeadOfGovernmentCharacterId(db, seatId as CountryId))
  );

  // ONE lookup for every head-of-government name rather than one per seat, and
  // none at all when no seat has a head — the common case on a quiet board.
  const heldHeadIds = headIds.filter((id): id is ObjectId => id !== null);
  const headNameById = new Map<string, string>();
  if (heldHeadIds.length > 0) {
    const charactersCol = await getCharactersCollection(db);
    const rows = await charactersCol
      .find({ _id: { $in: heldHeadIds } }, { projection: { name: 1 } })
      .toArray();
    for (const row of rows) {
      if (row.name) headNameById.set(row._id.toString(), row.name);
    }
  }

  const ministerOffices = new Map(SEAT_COUNTRIES.map((id) => [id, foreignMinisterOffice(id)]));
  const defenseOffices = new Map(SEAT_COUNTRIES.map((id) => [id, defenseMinisterOffice(id)]));
  const pairs = SEAT_COUNTRIES.flatMap((seatId) => {
    const ids: { countryId: CountryId; positionId: string }[] = [];
    const foreignId = ministerOffices.get(seatId)?.positionId;
    if (foreignId) ids.push({ countryId: seatId as CountryId, positionId: foreignId });
    const defenseId = defenseOffices.get(seatId)?.positionId;
    if (defenseId) ids.push({ countryId: seatId as CountryId, positionId: defenseId });
    return ids;
  });
  const members =
    pairs.length > 0 ? await getCabinetMembersCollection(db).find({ $or: pairs }).toArray() : [];

  const ministerNameByCountry = new Map<string, string>();
  const defenseNameByCountry = new Map<string, string>();
  for (const member of members) {
    if (!member.characterId || !member.characterName) continue;
    const defenseId = defenseOffices.get(member.countryId as SettlementSeatKey)?.positionId;
    if (member.positionId === defenseId) {
      defenseNameByCountry.set(member.countryId, member.characterName);
    } else {
      ministerNameByCountry.set(member.countryId, member.characterName);
    }
  }

  const offices = {} as SettlementSeatOffices;
  SEAT_COUNTRIES.forEach((seatId, index) => {
    const headId = headIds[index];
    offices[seatId] = [
      {
        role: "headOfGovernment",
        title: COUNTRY_CONFIGS[seatId as CountryId].executiveTitle,
        holder: headId ? (headNameById.get(headId.toString()) ?? null) : null,
      },
      {
        role: "foreignMinister",
        title: ministerOffices.get(seatId)!.title,
        holder: ministerNameByCountry.get(seatId) ?? null,
      },
      {
        role: "defenseMinister",
        title: defenseOffices.get(seatId)!.title,
        holder: defenseNameByCountry.get(seatId) ?? null,
      },
    ];
  });
  return offices;
}

import type { Db } from "mongodb";
import type { CabinetMember } from "@/lib/db/types/cabinet";
import type { ElectedOfficial, PoliticalParty } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

const VOCATIONAL_SEATS = 43;
const TAOISEACH_PICKS = 11;
const UNIVERSITY_SEATS = 6;

export interface SeanadVocationalSeat {
  partyId: string;
  partyName: string;
  partyColor: string;
  seats: number;
}

export interface SeanadTaoiseachPick {
  characterId: string | null;
  characterName: string | null;
  partyId: string;
  partyName: string;
  partyColor: string;
  positionId: string | null;
  source: "cabinet" | "loyalist_fill";
}

export interface SeanadComposition {
  vocational: SeanadVocationalSeat[];
  taoiseachPicks: SeanadTaoiseachPick[];
  university: { seats: number };
  totals: {
    vocational: number;
    taoiseachPicks: number;
    university: number;
    seats: number;
  };
}

// Largest-remainder (Hamilton) allocation. Mirrors the algorithm in
// src/lib/turn/election/seatAllocation.ts so the cosmetic Seanad panel
// behaves the same way as the live Dáil seat math.
function allocateHamilton(
  seatShares: Map<string, number>,
  totalSeats: number
): Map<string, number> {
  const totalShare = [...seatShares.values()].reduce((s, n) => s + n, 0);
  if (totalShare === 0) return new Map();
  const exact = new Map<string, number>();
  for (const [k, v] of seatShares) exact.set(k, (v / totalShare) * totalSeats);
  const allocated = new Map<string, number>();
  for (const [k, e] of exact) allocated.set(k, Math.floor(e));
  let used = [...allocated.values()].reduce((s, n) => s + n, 0);
  const remainders = [...exact.entries()]
    .map(([k, e]) => ({ k, r: e - Math.floor(e) }))
    .sort((a, b) => b.r - a.r);
  let i = 0;
  while (used < totalSeats && i < remainders.length) {
    allocated.set(remainders[i].k, (allocated.get(remainders[i].k) ?? 0) + 1);
    used++;
    i++;
  }
  return allocated;
}

/**
 * Derive the 60-seat Seanad composition for cosmetic display on the Oireachtas
 * page. Read-only: no DB writes, no side effects. See design doc §3.3 Option A
 * and Phase 8 plan for the derivation rules.
 */
export async function deriveSeanadComposition(
  db: Db,
  countryId: CountryId
): Promise<SeanadComposition> {
  // Party label/color lookup keyed by sequentialId string (matches how
  // electedOfficials.party is stored).
  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId })
    .toArray();
  const partyByKey = new Map<string, PoliticalParty>();
  for (const p of parties) {
    if (p.sequentialId != null) partyByKey.set(String(p.sequentialId), p);
  }
  function partyLabel(partyId: string): { partyName: string; partyColor: string } {
    const p = partyByKey.get(partyId);
    if (!p) {
      return {
        partyName: partyId === "independent" ? "Independent" : partyId,
        partyColor: "#888888",
      };
    }
    return { partyName: p.name, partyColor: p.color };
  }

  // 1. Vocational — sum Dáil seats per party, allocate 43 via Hamilton.
  const dailRows = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({ countryId, officeType: "dail" })
    .toArray();
  const dailByParty = new Map<string, number>();
  for (const row of dailRows) {
    const partyId = row.party ?? "independent";
    const seats = row.seatsHeld ?? 1;
    dailByParty.set(partyId, (dailByParty.get(partyId) ?? 0) + seats);
  }
  const allocated = allocateHamilton(dailByParty, VOCATIONAL_SEATS);
  const vocational: SeanadVocationalSeat[] = [...allocated.entries()]
    .filter(([, n]) => n > 0)
    .map(([partyId, n]) => ({ partyId, ...partyLabel(partyId), seats: n }))
    .sort((a, b) => b.seats - a.seats);

  // 2. Taoiseach picks — cabinet (cap 11), then loyalist fill from governing party.
  const cabinetCursor = db
    .collection<CabinetMember>("cabinetMembers")
    .find({ countryId })
    .sort({ confirmedAt: 1 });
  const cabinet = await cabinetCursor.toArray();
  const cabinetPicks: SeanadTaoiseachPick[] = cabinet.slice(0, TAOISEACH_PICKS).map((m) => {
    const partyId = m.party ?? "independent";
    return {
      characterId: m.characterId.toString(),
      characterName: m.characterName,
      partyId,
      ...partyLabel(partyId),
      positionId: m.positionId,
      source: "cabinet" as const,
    };
  });

  let loyalistPartyId = "independent";
  if (cabinetPicks.length < TAOISEACH_PICKS) {
    const formation = (await db
      .collection("governmentFormations")
      .findOne({ _id: countryId as never })) as { governingPartyId?: string } | null;
    if (formation?.governingPartyId) loyalistPartyId = formation.governingPartyId;
  }
  const loyalistFill: SeanadTaoiseachPick[] = Array.from(
    { length: TAOISEACH_PICKS - cabinetPicks.length },
    () => ({
      characterId: null,
      characterName: null,
      partyId: loyalistPartyId,
      ...partyLabel(loyalistPartyId),
      positionId: null,
      source: "loyalist_fill" as const,
    })
  );

  const taoiseachPicks = [...cabinetPicks, ...loyalistFill];
  const vocationalTotal = vocational.reduce((s, v) => s + v.seats, 0);

  return {
    vocational,
    taoiseachPicks,
    university: { seats: UNIVERSITY_SEATS },
    totals: {
      vocational: vocationalTotal,
      taoiseachPicks: taoiseachPicks.length,
      university: UNIVERSITY_SEATS,
      seats: vocationalTotal + taoiseachPicks.length + UNIVERSITY_SEATS,
    },
  };
}

/**
 * Reopened founding districts receive bounded party slates from existing NPCs.
 * One eligible owner per local registered party supplies direct-only people;
 * this creates candidacies, with no new profiles or financial accounts.
 */
import { createHash } from "node:crypto";
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type { Election, ElectionCandidate, NPP, PoliticalParty } from "@/lib/db/types";
import type { BgFoundingAssemblyRecord } from "./foundingCount1990";
import {
  addBgFoundingRenewedNpcSlate,
  bgFoundingOpenNominationDistricts,
} from "./rules/foundingRenewal1990";
import { BG_1990_CONSTITUENCIES } from "./data/foundingDistricts1990";

function stableId(key: string) {
  return new ObjectId(createHash("sha256").update(key).digest("hex").slice(0, 24));
}
export async function planBgFoundingRenewedNpcSlates(input: {
  db: Db;
  session: ClientSession;
  receipt: BgFoundingAssemblyRecord;
  namespace: string;
  now: Date;
}) {
  const { db, session, namespace, now } = input;
  let receipt = input.receipt;
  const open = new Set(bgFoundingOpenNominationDistricts(receipt.count, receipt.first));
  if (!open.size) return { receipt, candidates: [] as ElectionCandidate[] };
  const regions = [
    ...new Set(BG_1990_CONSTITUENCIES.filter((row) => open.has(row.id)).map((row) => row.regionId)),
  ];
  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find(
      { countryId: "BG", regimeStatus: { $ne: "banned" } },
      { session, projection: { sequentialId: 1 } }
    )
    .toArray();
  const registered = new Set(
    parties
      .filter((row) => Number.isSafeInteger(row.sequentialId) && row.sequentialId > 0)
      .map((row) => String(row.sequentialId))
  );
  const npcs = await db
    .collection<NPP>("npps")
    .find(
      {
        countryId: "BG",
        homeState: { $in: regions },
        retiredAt: null,
        isTechnocrat: { $ne: true },
        party: { $in: [...registered] },
        $or: [
          { currentOffice: null },
          { "currentOffice.type": { $in: ["assemblyDeputy", "primeMinister"] } },
        ],
      },
      { session, projection: { name: 1, homeState: 1, party: 1 } }
    )
    .sort({ _id: 1 })
    .toArray();
  const liveRaces = await db
    .collection<Election>("elections")
    .find(
      { countryId: "BG", status: { $in: ["upcoming", "active", "completed"] } },
      { session, projection: { _id: 1 } }
    )
    .toArray();
  const filed = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find(
      { electionId: { $in: liveRaces.map((row) => row._id) }, isNPP: true, status: "active" },
      { session, projection: { nppId: 1 } }
    )
    .toArray();
  const used = new Set([
    ...receipt.nominees.filter((row) => row.isNpc).map((row) => row.ownerId),
    ...filed.flatMap((row) => (row.nppId ? [row.nppId.toHexString()] : [])),
  ]);
  const partiesPlanned = new Set<string>();
  const candidates: ElectionCandidate[] = [];
  for (const npc of npcs) {
    const key = `${npc.homeState}:${npc.party}`;
    if (used.has(npc._id.toHexString()) || partiesPlanned.has(key)) continue;
    const id = stableId(`${namespace}:renewed-npc:${npc._id.toHexString()}`);
    const nominations = addBgFoundingRenewedNpcSlate({
      count: receipt.count,
      first: receipt.first,
      nominations: receipt.nominations,
      owner: {
        candidateId: id.toHexString(),
        ownerId: npc._id.toHexString(),
        partyId: npc.party,
        regionId: npc.homeState,
      },
    });
    if (nominations.people.length === receipt.nominations.people.length) continue;
    const electionId = stableId(`${namespace}:runoff:${npc.homeState}`);
    receipt = {
      ...receipt,
      nominations,
      nominees: [
        ...receipt.nominees,
        {
          id: id.toHexString(),
          ownerId: npc._id.toHexString(),
          electionId: electionId.toHexString(),
          isNpc: true,
          party: npc.party,
          name: npc.name,
          regionId: npc.homeState,
        },
      ],
    };
    candidates.push({
      _id: id,
      electionId,
      countryId: "BG",
      characterId: npc._id,
      characterName: npc.name,
      party: npc.party,
      status: "active",
      support: 0,
      enteredAt: now,
      isNPP: true,
      nppId: npc._id,
      bulgarianFoundingNomination: { rootCandidateId: id.toHexString() },
    });
    used.add(npc._id.toHexString());
    partiesPlanned.add(key);
  }
  return { receipt, candidates };
}

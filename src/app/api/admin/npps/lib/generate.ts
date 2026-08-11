import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { generateNPP, calculateQualityBonus, calculateNPPsToGenerate } from "@/lib/npp/generator";
import type { NPP, Election, ElectionCandidate, StatePartyOrg } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import type { Db } from "@/lib/mongodb";
import { getNextSequentialId } from "@/lib/db/sequentialId";
import { getEraContext } from "@/lib/era/context";
import { DEFAULT_CANDIDATE_SUPPORT } from "@/lib/electionEngine/electionFormulaFactors";

type PartyData = { countryId: string; partyId: string };

export async function handleGenerateNPPs(
  db: Db,
  stateFilter: string[] | undefined,
  partyFilter: string[] | undefined,
  partyData?: PartyData[]
): Promise<NextResponse> {
  // Read once: the portrait filter is per-NPP but the clock is per-world.
  const eraYear = (await getEraContext(db)).year;

  const electionQuery: Record<string, unknown> = {
    status: { $in: ["upcoming", "active"] },
  };

  if (stateFilter && stateFilter.length > 0) {
    electionQuery.state = { $in: stateFilter };
  }

  const elections = await db.collection<Election>("elections").find(electionQuery).toArray();

  if (elections.length === 0) {
    return NextResponse.json({
      message: "No elections found to populate with NPPs",
      generated: 0,
    });
  }

  // Determine default parties based on election countries present, using sequentialIds.
  // Default `countryId` of legacy elections is "US".
  const countriesPresent = new Set<CountryId>(
    elections.map((e) => (e.countryId ?? "US") as CountryId)
  );

  // Load party docs to map sequentialIds and determine country
  const allPartyDocs = await db
    .collection<import("@/lib/db/types").PoliticalParty>("politicalParties")
    .find({ isDefault: true })
    .toArray();
  // Build country-aware party list
  let partiesToGenerateWithCountry: PartyData[] = [];

  if (partyData && partyData.length > 0) {
    // Use explicit country-aware party data from client
    partiesToGenerateWithCountry = partyData;
  } else if (partyFilter && partyFilter.length > 0) {
    // Legacy: partyFilter is just party IDs — find each party doc and read its countryId.
    for (const partyId of partyFilter) {
      const party = allPartyDocs.find((p) => String(p.sequentialId) === partyId);
      if (party) {
        const countryId = (party.countryId ?? "US") as CountryId;
        partiesToGenerateWithCountry.push({ countryId, partyId });
      }
    }
  } else {
    // Default: top 2 default parties per country present in the election set
    for (const countryId of countriesPresent) {
      const major = allPartyDocs
        .filter((p) => ((p.countryId ?? "US") as CountryId) === countryId)
        .slice(0, 2);
      partiesToGenerateWithCountry.push(
        ...major.map((p) => ({ countryId, partyId: String(p.sequentialId) }))
      );
    }
  }

  const electionsByState = new Map<string, Election[]>();
  for (const election of elections) {
    const stateElections = electionsByState.get(election.state) || [];
    stateElections.push(election);
    electionsByState.set(election.state, stateElections);
  }

  // Pre-batch: all statePartyOrg docs needed across every state-party combination
  const allStatePartyKeys: string[] = [];
  for (const [stateId] of electionsByState) {
    for (const { partyId } of partiesToGenerateWithCountry) {
      allStatePartyKeys.push(`${stateId}_${partyId}`);
    }
  }
  const statePartyOrgDocs = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .find({ _id: { $in: allStatePartyKeys } })
    .toArray();
  const statePartyOrgMap = new Map(statePartyOrgDocs.map((doc) => [doc._id as string, doc]));

  // States that have ANY statePartyOrg data (for any party): in those states a
  // party with no row has no seeded presence and is skipped rather than being
  // handed the legacy `?? 50` default (which out-ranked parties with real
  // single-digit org). States with no org data at all keep the legacy default
  // so unseeded/test worlds still work.
  const statesWithOrgData = new Set<string>(
    await db
      .collection<StatePartyOrg>("statePartyOrg")
      .distinct("stateId", { stateId: { $in: [...electionsByState.keys()] } })
  );

  // Pre-batch: which (electionId, partyId) pairs already have an active candidate
  const allElectionIds = elections.map((e) => e._id as import("mongodb").ObjectId);
  const allPartyIds = partiesToGenerateWithCountry.map((p) => p.partyId);
  const existingCandidateDocs = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find(
      { electionId: { $in: allElectionIds }, party: { $in: allPartyIds }, status: "active" },
      { projection: { electionId: 1, party: 1 } }
    )
    .toArray();
  const existingCandidateKeys = new Set(
    existingCandidateDocs.map(
      (c) => `${(c.electionId as import("mongodb").ObjectId).toString()}_${c.party}`
    )
  );

  let totalGenerated = 0;
  const details: string[] = [];

  for (const [stateId, stateElections] of electionsByState) {
    // Determine country from the first election in this state (state IDs are country-scoped)
    const stateCountry = (stateElections[0].countryId ?? "US") as CountryId;

    for (const { countryId: partyCountry, partyId } of partiesToGenerateWithCountry) {
      // Skip cross-country mismatches
      if (stateCountry !== partyCountry) continue;

      const statePartyKey = `${stateId}_${partyId}`;
      const statePartyOrg = statePartyOrgMap.get(statePartyKey);

      // Regional-presence gate: in a state with seeded org data, a party with
      // no row (or hasPresence: false) has no presence there and fields no
      // NPPs (e.g. SNP outside Scotland). The `?? 50` fallback survives ONLY
      // for states with no statePartyOrg data at all (unseeded worlds).
      if (statesWithOrgData.has(stateId)) {
        if (!statePartyOrg) continue;
        if (statePartyOrg.hasPresence === false) continue;
      }
      const partyOrg = statePartyOrg ? Math.max(0, statePartyOrg.organization ?? 0) : 50;
      const quality = calculateQualityBonus(partyOrg);
      const nppsToGenerate = calculateNPPsToGenerate(stateElections.length, partyOrg);

      const availableElections: Election[] = [];
      for (const election of stateElections) {
        const key = `${(election._id as import("mongodb").ObjectId).toString()}_${partyId}`;
        if (!existingCandidateKeys.has(key)) {
          availableElections.push(election);
        }
      }

      availableElections.sort((a, b) => {
        const priority: Record<string, number> = {
          house: 0,
          commons: 0,
          bundestag: 0,
          shugiin: 0,
          npcDelegate: 0,
          stateSenate: 1,
          regionalCouncil: 1,
          landtag: 1,
          peoplesCongress: 1,
          governor: 2,
          ministerPresident: 2,
          senate: 3,
          sangiin: 3,
        };
        return (priority[a.electionType] ?? 4) - (priority[b.electionType] ?? 4);
      });

      const nppsToCreate = Math.min(nppsToGenerate, availableElections.length);

      for (let i = 0; i < nppsToCreate; i++) {
        const election = availableElections[i];

        let targetOffice: NPP["currentOffice"] | undefined;
        switch (election.electionType) {
          case "senate":
            targetOffice = { type: "senate", state: election.state };
            break;
          case "house":
            targetOffice = { type: "house", state: election.state, seatsHeld: 1 };
            break;
          case "stateSenate":
            targetOffice = { type: "stateSenate", state: election.state, seatsHeld: 1 };
            break;
          case "governor":
            targetOffice = { type: "governor", state: election.state };
            break;
          case "commons":
            targetOffice = { type: "commons", state: election.state };
            break;
          case "regionalCouncil":
            targetOffice = { type: "regionalCouncil", state: election.state, seatsHeld: 1 };
            break;
          case "bundestag":
            targetOffice = { type: "bundestag", state: election.state, seatsHeld: 1 };
            break;
          case "ministerPresident":
            targetOffice = { type: "ministerPresident", state: election.state };
            break;
          case "shugiin":
            targetOffice = { type: "shugiin", state: election.state, seatsHeld: 1 };
            break;
          case "sangiin":
            targetOffice = { type: "sangiin", state: election.state, seatsHeld: 1 };
            break;
          case "landtag":
            targetOffice = { type: "landtag", state: election.state, seatsHeld: 1 };
            break;
          case "npcDelegate":
            targetOffice = { type: "npcDelegate", state: election.state, seatsHeld: 1 };
            break;
          case "peoplesCongress":
            targetOffice = { type: "peoplesCongress", state: election.state, seatsHeld: 1 };
            break;
          case "dail":
            targetOffice = { type: "dail", state: election.state, seatsHeld: 1 };
            break;
          case "seanad":
            targetOffice = { type: "seanad", state: election.state, seatsHeld: 1 };
            break;
          case "uachtaran":
            // National single-seat; no state.
            targetOffice = { type: "uachtaran" };
            break;
          case "localCouncil":
            targetOffice = { type: "localCouncil", state: election.state, seatsHeld: 1 };
            break;
          default:
            continue;
        }

        const npp = await generateNPP({
          state: stateId,
          party: partyId,
          countryId: stateCountry,
          targetOffice,
          quality,
          // Portrait era: a 1953 politician must not draw a 2010s press photo.
          year: eraYear,
        });

        // Assign sequential ID
        const sequentialId = await getNextSequentialId(db, "npp");
        const nppWithId: NPP = { ...npp, sequentialId };

        await db.collection<NPP>("npps").insertOne(nppWithId);

        const candidateEntry: ElectionCandidate = {
          _id: new ObjectId(),
          electionId: election._id,
          countryId: (election.countryId ?? stateCountry) as ElectionCandidate["countryId"],
          characterId: nppWithId._id,
          characterName: nppWithId.name,
          party: partyId,
          status: "active",
          support: DEFAULT_CANDIDATE_SUPPORT,
          isNPP: true,
          nppId: nppWithId._id,
          enteredAt: new Date(),
        };

        await db.collection<ElectionCandidate>("electionCandidates").insertOne(candidateEntry);

        totalGenerated++;
        details.push(`${stateId} ${election.electionType} (${partyId})`);
      }
    }
  }

  return NextResponse.json({
    message: `Generated ${totalGenerated} NPP candidate(s)`,
    generated: totalGenerated,
    elections: elections.length,
    states: electionsByState.size,
    details: details.slice(0, 20),
  });
}

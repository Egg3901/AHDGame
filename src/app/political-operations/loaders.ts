import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { ensureCampaignForCandidate } from "@/lib/campaigns/createInitialCampaign";
import type { ElectionCandidate, Election } from "@/lib/db/types";

export interface PoliticalOperationsPageData {
  character: {
    _id: string;
    name: string;
    countryId: string;
    homeState: string;
  };
  /**
   * Active candidacy in the current presidential election, or null.
   * `campaignId` is the Campaign document id (resolved/created on load) — the
   * Campaign Manager iframe loads `/campaign/{campaignId}`, NOT the electionId.
   */
  activePresidentialCandidacy: {
    electionId: string;
    candidateId: string;
    campaignId: string;
  } | null;
}

/**
 * Load the political-operations snapshot for the authenticated character.
 * Returns null when the request is unauthenticated or the character is not
 * a US national. The page itself enforces the country gate; this loader is
 * the single source of truth for the `/api/political-operations/me` route.
 */
export async function loadPoliticalOperationsData(): Promise<PoliticalOperationsPageData | null> {
  const auth = await requireAuthWithCharacter();
  if (!auth.ok) return null;
  const char = auth.user.character;
  if (char.countryId !== "US") return null;

  const db = await getDb();
  const candidacies = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({ characterId: char._id, status: "active" })
    .toArray();

  let activePresidentialCandidacy: PoliticalOperationsPageData["activePresidentialCandidacy"] =
    null;
  if (candidacies.length > 0) {
    const electionIds = candidacies.map((c) => c.electionId);
    const election = await db.collection<Election>("elections").findOne(
      {
        _id: { $in: electionIds },
        electionType: "president",
        status: { $in: ["upcoming", "active"] },
      },
      { projection: { _id: 1 } }
    );
    if (election) {
      const candidacy = candidacies.find((c) => c.electionId.equals(election._id));
      if (candidacy) {
        // Resolve (creating if missing) the Campaign document for this candidate
        // so the iframe can address it by campaign id. The campaign is keyed by
        // the character _id, not the candidacy row _id.
        const campaignId = await ensureCampaignForCandidate({
          db,
          electionId: candidacy.electionId,
          candidateId: char._id,
          candidateIsNPP: false,
          party: char.party,
        });
        activePresidentialCandidacy = {
          electionId: candidacy.electionId.toString(),
          candidateId: candidacy._id.toString(),
          campaignId: campaignId.toString(),
        };
      }
    }
  }

  return {
    character: {
      _id: char._id.toString(),
      name: char.name,
      countryId: char.countryId,
      homeState: char.homeState,
    },
    activePresidentialCandidacy,
  };
}

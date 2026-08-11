import { getAuthUserWithCharacter } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { redirect } from "next/navigation";
import { ObjectId } from "mongodb";
import type { Campaign, Character, Election, PoliticalParty } from "@/lib/db/types";
import { isCampaignEligibleElection } from "@/lib/campaigns/isCampaignEligible";
import Link from "next/link";

export default async function CampaignPage() {
  const user = await getAuthUserWithCharacter();

  if (!user?.hasCharacter) {
    redirect("/unauthorized?reason=You must have a character to access campaign management");
  }

  const db = await getDb();
  const userOid = new ObjectId(user.userId);

  // Multi-profile aware: find every character this user owns so campaigns on
  // any of their characters (not just the active one) resolve. Includes retired
  // characters — a presidential run from a prior life still surfaces the manager.
  const userCharacters = await db
    .collection<Character>("characters")
    .find({ userId: userOid }, { projection: { _id: 1 } })
    .toArray();
  const characterOids = userCharacters.map((c) => c._id);

  // Find all campaigns tied to this account (any character) or where user is the
  // campaign manager. Phase 5.5 extends Campaign Manager beyond presidential to
  // US senate / governor / house / state-senate; the redirect prefers the
  // highest-priority eligible race (president > governor > senate > house >
  // stateSenate) per typical career importance.
  const candidateCampaigns = await db
    .collection<Campaign>("campaigns")
    .find({
      $or: [
        { managerId: userOid },
        ...(characterOids.length > 0 ? [{ candidateId: { $in: characterOids } }] : []),
      ],
    })
    .toArray();

  if (candidateCampaigns.length > 0) {
    const electionIds = candidateCampaigns.map((c) => c.electionId);
    const eligibleElections = await db
      .collection<Election>("elections")
      .find({ _id: { $in: electionIds } })
      .toArray();
    const racePriority: Record<string, number> = {
      president: 0,
      governor: 1,
      senate: 2,
      house: 3,
      stateSenate: 4,
    };
    const eligibleByPriority = eligibleElections
      .filter((e) => isCampaignEligibleElection(e))
      .sort((a, b) => (racePriority[a.electionType] ?? 99) - (racePriority[b.electionType] ?? 99));
    if (eligibleByPriority.length > 0) {
      const target = eligibleByPriority[0];
      const targetCampaign = candidateCampaigns.find(
        (c) => c.electionId.toString() === target._id.toString()
      );
      if (targetCampaign) {
        redirect(`/campaign/${targetCampaign._id.toString()}`);
      }
    }
  }

  // Officer redirect: chair / vice chair / treasurer of a party with an active
  // presidential candidate routes to that campaign even when not nominee/manager.
  // Mirrors the visibility check in /api/client-nav.
  if (characterOids.length > 0) {
    const presElections = await db
      .collection<Election>("elections")
      .find({ electionType: "president", status: "active" })
      .project({ _id: 1, countryId: 1 })
      .toArray();
    if (presElections.length > 0) {
      const officerParties = await db
        .collection<PoliticalParty>("politicalParties")
        .find({
          countryId: { $in: presElections.map((e) => e.countryId) },
          $or: [
            { chairId: { $in: characterOids } },
            { viceChairId: { $in: characterOids } },
            { treasurerId: { $in: characterOids } },
          ],
        })
        .project({ sequentialId: 1, countryId: 1 })
        .toArray();
      if (officerParties.length > 0) {
        const electionByCountry = new Map<string, ObjectId[]>();
        for (const e of presElections) {
          const list = electionByCountry.get(e.countryId) ?? [];
          list.push(e._id);
          electionByCountry.set(e.countryId, list);
        }
        const orClauses = officerParties
          .filter((p) => electionByCountry.has(p.countryId))
          .map((p) => ({
            party: String(p.sequentialId),
            electionId: { $in: electionByCountry.get(p.countryId)! },
          }));
        if (orClauses.length > 0) {
          const officerCampaign = await db
            .collection<Campaign>("campaigns")
            .findOne({ $or: orClauses });
          if (officerCampaign) {
            redirect(`/campaign/${officerCampaign._id.toString()}`);
          }
        }
      }
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="max-w-lg w-full">
        <div className="rounded-xl border border-card-border bg-card p-8 text-center space-y-4">
          <h1 className="text-2xl font-bold text-foreground">No Presidential Campaign</h1>
          <p className="text-muted">
            The campaign manager is a presidential-race feature. You are not currently running in a
            presidential race or managing a presidential campaign.
          </p>
          <p className="text-sm text-muted/70">
            Campaign management becomes available when you&apos;re a candidate in a presidential
            primary or general election, or are assigned as the campaign&apos;s manager.
          </p>
          <Link
            href="/elections"
            className="inline-block mt-4 px-6 py-2 rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors"
          >
            View Elections
          </Link>
        </div>
      </div>
    </div>
  );
}

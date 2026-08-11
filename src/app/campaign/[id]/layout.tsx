import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import type { Metadata } from "next";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { Campaign } from "@/lib/db/types/campaign";
import type { Election } from "@/lib/db/types/election";
import type { Character } from "@/lib/db/types/character";
import type { NPP } from "@/lib/db/types/npp";
import { getSiteUrl } from "@/lib/siteMetadata";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

const ELECTION_TYPE_LABELS: Record<string, string> = {
  president: "Presidential Election",
  senate: "Senate Election",
  house: "House Election",
  governor: "Governor Election",
  stateSenate: "State Senate Election",
  commons: "General Election",
  primeMinister: "Prime Minister Election",
  holyrood: "Holyrood Election",
  senedd: "Senedd Election",
};

function describeElection(election: Pick<Election, "electionType" | "state"> | null): string {
  if (!election) return "Election";
  const typeLabel = ELECTION_TYPE_LABELS[election.electionType] ?? "Election";
  const stateStr =
    election.state &&
    !["president", "commons", "snap_commons", "primeMinister"].includes(election.electionType)
      ? ` — ${election.state}`
      : "";
  return `${typeLabel}${stateStr}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  if (!ObjectId.isValid(id)) return {};

  const db = await getDb();
  const campaign = await db
    .collection<Campaign>("campaigns")
    .findOne(
      { _id: new ObjectId(id) },
      { projection: { electionId: 1, candidateId: 1, candidateIsNPP: 1 } }
    );
  if (!campaign) return {};

  const [election, candidate, npp] = await Promise.all([
    db
      .collection<Election>("elections")
      .findOne({ _id: campaign.electionId }, { projection: { electionType: 1, state: 1 } }),
    campaign.candidateIsNPP
      ? Promise.resolve(null)
      : db
          .collection<Character>("characters")
          .findOne({ _id: campaign.candidateId }, { projection: { name: 1, avatarUrl: 1 } }),
    campaign.candidateIsNPP
      ? db
          .collection<NPP>("npps")
          .findOne({ _id: campaign.candidateId }, { projection: { name: 1, avatarUrl: 1 } })
      : Promise.resolve(null),
  ]);

  const candidateName = candidate?.name ?? npp?.name ?? "Candidate";
  const electionLabel = describeElection(election);
  const title = `${candidateName} — ${electionLabel} | A House Divided`;
  const description = `${candidateName}'s campaign for ${electionLabel}. Fundraising, ground game, and polling.`;
  const url = `${getSiteUrl()}/campaign/${id}`;
  const image = candidate?.avatarUrl ?? npp?.avatarUrl ?? CDN_LOGO_URL;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      type: "article",
      url,
      images: [{ url: image, width: 512, height: 512, alt: candidateName }],
    },
    twitter: { card: "summary", title, description, images: [image] },
  };
}

export default function CampaignLayout({ children }: LayoutProps) {
  return <>{children}</>;
}

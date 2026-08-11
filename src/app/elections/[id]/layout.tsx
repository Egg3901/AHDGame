import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import type { Metadata } from "next";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { Election } from "@/lib/db/types";
import { isSeatId } from "@/lib/elections/resolveElection";

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
  dail: "Dáil Éireann Election",
  seanad: "Seanad Éireann Election",
  uachtaran: "Uachtarán na hÉireann Election",
  localCouncil: "Local Council Election",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;

  const db = await getDb();
  const projection = { electionType: 1, state: 1, cycle: 1, status: 1, countryId: 1 } as const;
  // Most links in the app use the seatId form ("US-house-OH"), not an
  // ObjectId. The old ObjectId-only guard bailed on those, so the pages that
  // players actually share shipped no title and no OG tags at all.
  const election = isSeatId(id)
    ? await db
        .collection<Election>("elections")
        .find({ seatId: id }, { projection })
        .sort({ cycle: -1 })
        .limit(1)
        .next()
    : ObjectId.isValid(id)
      ? await db
          .collection<Election>("elections")
          .findOne({ _id: new ObjectId(id) }, { projection })
      : null;
  if (!election) return {};

  const typeLabel = ELECTION_TYPE_LABELS[election.electionType] ?? "Election";
  const stateStr =
    election.state &&
    !["president", "commons", "primeMinister", "uachtaran"].includes(election.electionType)
      ? ` — ${election.state}`
      : "";
  const title = `${typeLabel}${stateStr} | A House Divided`;
  const description = `Follow the ${typeLabel.toLowerCase()}${stateStr} in A House Divided, the real-time political simulation game.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      url: `https://ahousedividedgame.com/elections/${id}`,
      images: [{ url: CDN_LOGO_URL, width: 512, height: 512, alt: "A House Divided" }],
    },
    twitter: {
      card: "summary",
      title,
      description,
      images: [CDN_LOGO_URL],
    },
  };
}

export default function ElectionLayout({ children }: LayoutProps) {
  return <>{children}</>;
}

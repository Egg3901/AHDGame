import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import type { Metadata } from "next";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { Election } from "@/lib/db/types/election";
import { resolveElectionYear } from "@/lib/utils/formatters";
import { getWikiSiteUrl } from "@/lib/siteMetadata";

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
  if (!ObjectId.isValid(id)) return {};

  const db = await getDb();
  const election = await db.collection<Election>("elections").findOne(
    { _id: new ObjectId(id), status: { $in: ["completed", "resolved"] } },
    {
      projection: {
        electionType: 1,
        state: 1,
        cycle: 1,
        electionYear: 1,
        senateClass: 1,
        chamberClass: 1,
      },
    }
  );
  if (!election) return {};

  const typeLabel = ELECTION_TYPE_LABELS[election.electionType] ?? "Election";
  const year = resolveElectionYear(election);
  const stateStr =
    election.state &&
    !["president", "commons", "snap_commons", "primeMinister", "uachtaran"].includes(
      election.electionType
    )
      ? ` — ${election.state}`
      : "";
  const title = `${year} ${typeLabel}${stateStr} — Wiki | A House Divided`;
  const description = `Historical results, candidates, and analysis for the ${year} ${typeLabel.toLowerCase()}${stateStr}.`;
  const url = `${getWikiSiteUrl()}/elections/${id}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      type: "article",
      url,
      images: [{ url: CDN_LOGO_URL, width: 512, height: 512, alt: "A House Divided" }],
    },
    twitter: { card: "summary", title, description, images: [CDN_LOGO_URL] },
  };
}

export default function WikiElectionLayout({ children }: LayoutProps) {
  return <>{children}</>;
}

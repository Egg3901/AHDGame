import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import type { Metadata } from "next";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { Election } from "@/lib/db/types/election";
import type { State } from "@/lib/db/types";
import { canonicalRegionId } from "@/lib/constants/countries";
import { getSiteUrl } from "@/lib/siteMetadata";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string; code: string; stateId: string }>;
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
  params: Promise<{ id: string; code: string; stateId: string }>;
}): Promise<Metadata> {
  const { id, code, stateId } = await params;
  if (!ObjectId.isValid(id)) return {};

  const db = await getDb();
  const election = await db
    .collection<Election>("elections")
    .findOne({ _id: new ObjectId(id) }, { projection: { electionType: 1, cycle: 1 } });
  if (!election) return {};

  const typeLabel = ELECTION_TYPE_LABELS[election.electionType] ?? "Election";
  // Resolve the region's display name — the raw param may be a compact code
  // (BUD) or a full prefixed id (HU_BUD), neither of which belongs in copy.
  const countryId = code.toUpperCase();
  // `states._id` is globally unique across countries, so the id alone is a
  // sufficient (and Filter<State>-typed) lookup for the raw URL param.
  const state = await db
    .collection<State>("states")
    .findOne(
      { _id: canonicalRegionId(countryId, stateId.toUpperCase()) },
      { projection: { name: 1 } }
    );
  const regionName = state?.name ?? stateId;
  const title = `${typeLabel} — ${regionName} | A House Divided`;
  const description = `Regional results for the ${typeLabel.toLowerCase()} in ${regionName}, ${countryId} — county / district breakdown.`;
  const url = `${getSiteUrl()}/elections/${id}/country/${code}/region/${stateId}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      type: "website",
      url,
      images: [{ url: CDN_LOGO_URL, width: 512, height: 512, alt: "A House Divided" }],
    },
    twitter: { card: "summary", title, description, images: [CDN_LOGO_URL] },
  };
}

export default function ElectionRegionLayout({ children }: LayoutProps) {
  return <>{children}</>;
}

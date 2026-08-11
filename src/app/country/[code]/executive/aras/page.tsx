import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { SectionLabel } from "@/components/ui";
import { PartyChip } from "@/app/congress/components/CongressShared";
import { getDb } from "@/lib/mongodb";
import { type CountryId } from "@/lib/constants/countries";
import { getCountryFlagUrl } from "@/lib/constants";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import type { Character, ElectedOfficial, PoliticalParty } from "@/lib/db/types";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ code: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const id = code.toUpperCase() as CountryId;
  if (id !== "IE") return { title: "Áras Not Found | A House Divided" };
  return {
    title: "Áras an Uachtaráin | A House Divided",
    description:
      "Office of the President of Ireland — sitting holder and Council of State ex-officio members.",
  };
}

export default async function ArasPage({ params }: PageProps) {
  const { code } = await params;
  const id = code.toUpperCase() as CountryId;
  if (id !== "IE") notFound();

  const db = await getDb();

  // Sitting Uachtarán
  const uachtaranOfficial = await db.collection<ElectedOfficial>("electedOfficials").findOne({
    countryId: "IE",
    officeType: "uachtaran",
  });
  let uachtaran: Character | null = null;
  let uachtaranParty: PoliticalParty | null = null;
  if (uachtaranOfficial?.characterId) {
    uachtaran = await db
      .collection<Character>("characters")
      .findOne({ _id: uachtaranOfficial.characterId });
    if (uachtaran?.party) {
      const seq = Number.parseInt(uachtaran.party, 10);
      if (!Number.isNaN(seq)) {
        uachtaranParty = await db
          .collection<PoliticalParty>("politicalParties")
          .findOne({ countryId: "IE", sequentialId: seq });
      }
    }
  }

  // Ex-officio Council of State (placeholder — §3.7 α)
  const govFormation = await getGovernmentFormationsCollection(db).findOne({ _id: "IE" });
  const taoiseachId = govFormation?.pmCharacterId ?? null;
  const taoiseach = taoiseachId
    ? await db.collection<Character>("characters").findOne({ _id: taoiseachId })
    : null;
  // Tánaiste is seated through the cabinet (positionId "tanaiste"), so the
  // unified cabinetMembers collection is the source of truth — same as the
  // executive hub and cabinet page. (No electedOfficials row exists for it.)
  const tanaisteMember = await getCabinetMembersCollection(db).findOne({
    countryId: "IE",
    positionId: "tanaiste",
  });
  const tanaiste = tanaisteMember?.characterId
    ? await db.collection<Character>("characters").findOne({ _id: tanaisteMember.characterId })
    : null;

  const heroSrc = getCountryFlagUrl("IE");
  const uachtaranHref = uachtaran
    ? `/character/${uachtaran.sequentialId ?? uachtaran._id.toString()}`
    : null;

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
        {/* Hero */}
        <div className="relative overflow-hidden rounded-2xl border border-card-border bg-card">
          <div className="absolute inset-0 opacity-30">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={heroSrc} alt="Flag of Ireland" className="h-full w-full object-cover" />
          </div>
          <div className="relative p-8">
            <p className="text-xs uppercase tracking-widest text-muted">
              <Link href="/country/ie/executive" className="hover:text-foreground">
                Government Buildings
              </Link>{" "}
              · Áras an Uachtaráin
            </p>
            <h1 className="mt-2 text-3xl font-bold text-foreground">Office of the Uachtarán</h1>
            <p className="mt-1 text-body-sm text-muted">
              Head of state of Ireland — directly elected to a seven-year term, maximum two terms
              (Bunreacht na hÉireann, Article 12).
            </p>
          </div>
        </div>

        {/* Sitting Uachtarán card */}
        <section className="rounded-2xl border border-card-border bg-card p-6 shadow-card">
          <SectionLabel as="h2">Sitting Uachtarán</SectionLabel>
          {uachtaran ? (
            <div className="flex items-center gap-4">
              <Link href={uachtaranHref!} className="shrink-0">
                <Avatar
                  url={uachtaran.avatarUrl}
                  name={uachtaran.name}
                  size="h-20 w-20"
                  className="rounded-xl text-3xl ring-2 ring-card-border"
                />
              </Link>
              <div className="min-w-0 flex-1">
                <Link
                  href={uachtaranHref!}
                  className="text-body-lg font-semibold text-foreground transition-colors hover:text-primary"
                >
                  {uachtaran.name}
                </Link>
                {uachtaranParty && (
                  <div className="mt-1">
                    <PartyChip
                      partyName={uachtaranParty.name}
                      partyColor={uachtaranParty.color}
                      partyId={uachtaran.party}
                      countryId="IE"
                      logoUrl={uachtaranParty.logoUrl}
                    />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-card-elevated text-3xl text-muted ring-2 ring-dashed ring-card-border">
                —
              </div>
              <div className="flex-1">
                <p className="italic text-muted">No sitting Uachtarán</p>
                <p className="mt-0.5 text-body-sm text-muted">
                  The Office of the Uachtarán is vacant. The next nationwide election will be
                  spawned at the start of the canonical cycle.
                </p>
              </div>
            </div>
          )}
        </section>

        {/* Council of State (placeholder per §3.7 α) */}
        <section className="rounded-2xl border border-card-border bg-card p-6 shadow-card">
          <SectionLabel as="h2">Council of State (Comhairle Stáit)</SectionLabel>
          <p className="mt-1 text-body-sm text-muted leading-relaxed mb-4">
            The Council of State advises the Uachtarán on the exercise of reserved presidential
            powers (Article 31). Ex-officio members derived from sitting offices:
          </p>
          <ul className="space-y-2 text-body-sm">
            <li className="flex items-baseline justify-between gap-4">
              <span className="font-medium text-foreground">Taoiseach</span>
              <span className="text-muted">{taoiseach?.name ?? "(vacant)"}</span>
            </li>
            <li className="flex items-baseline justify-between gap-4">
              <span className="font-medium text-foreground">Tánaiste</span>
              <span className="text-muted">{tanaiste?.name ?? "(vacant)"}</span>
            </li>
            <li className="flex items-baseline justify-between gap-4">
              <span className="font-medium text-foreground">Chief Justice</span>
              <span className="text-muted italic">not modeled</span>
            </li>
            <li className="flex items-baseline justify-between gap-4">
              <span className="font-medium text-foreground">Ceann Comhairle</span>
              <span className="text-muted italic">not modeled</span>
            </li>
            <li className="flex items-baseline justify-between gap-4">
              <span className="font-medium text-foreground">Cathaoirleach of the Seanad</span>
              <span className="text-muted italic">not modeled</span>
            </li>
            <li className="flex items-baseline justify-between gap-4">
              <span className="font-medium text-foreground">Attorney General</span>
              <span className="text-muted italic">not modeled</span>
            </li>
          </ul>
          <p className="mt-4 text-xs text-muted italic">
            Presidential nominees and former office-holders not modeled. Article 26 referral (bills
            referred to the Supreme Court for constitutional review) is a planned future feature
            gated on a cross-country judiciary subsystem.
          </p>
        </section>
      </main>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { getPartyData } from "@/lib/wiki/partyData";
import { getPartyFlavor } from "@/lib/wiki/partyFlavor";
import { PolicyAlignmentCard } from "@/components/PolicyAlignmentCard";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ country?: string }>;
}

function parseCountryParam(country?: string): CountryId {
  const normalized = country?.toUpperCase();
  return normalized && normalized in COUNTRY_CONFIGS ? (normalized as CountryId) : "US";
}

export async function generateMetadata({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { country } = await searchParams;
  const data = await getPartyData(id, parseCountryParam(country));
  if (!data) return { title: "Not Found" };
  return {
    title: `${data.name} | Wiki | A House Divided`,
    description: `Political party: ${data.name}`,
  };
}

export default async function WikiPartyPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { country } = await searchParams;
  const data = await getPartyData(id, parseCountryParam(country));
  if (!data) notFound();

  const flavor = getPartyFlavor(data.id, data.name, data.abbreviation);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <nav className="mb-6 flex items-center gap-2 text-sm text-muted">
        <Link href="/wiki" className="hover:text-foreground">
          Wiki
        </Link>
        <span aria-hidden>/</span>
        <Link href="/wiki#parties" className="hover:text-foreground">
          Parties
        </Link>
        <span aria-hidden>/</span>
        <span className="text-foreground">{data.name}</span>
      </nav>

      <header className="mb-8">
        <div className="flex items-center gap-4">
          <div
            className="h-16 w-16 shrink-0 rounded-xl"
            style={{ backgroundColor: data.color + "40", border: `2px solid ${data.color}` }}
          />
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">{data.name}</h1>
            <p className="mt-1 text-muted">
              {data.abbreviation} • {data.memberCount} member{data.memberCount !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      </header>

      <section className="mb-8 rounded-xl border border-card-border bg-card/60 p-6 shadow-card">
        <h2 className="mb-3 text-lg font-semibold text-foreground">About</h2>
        <p className="text-muted leading-relaxed">{flavor.blurb}</p>
        <h3 className="mt-4 mb-2 text-sm font-medium text-foreground">In the Game</h3>
        <ul className="list-inside list-disc space-y-1 text-sm text-muted">
          {flavor.tips.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="mb-4 text-xl font-semibold text-foreground">Political Positions</h2>
        <PolicyAlignmentCard
          economic={data.economicPosition}
          social={data.socialPosition}
          hideTitle
        />
      </section>

      <section className="mb-8 rounded-xl border border-card-border bg-card/60 p-6 shadow-card">
        <h2 className="mb-4 text-xl font-semibold text-foreground">Seats Held</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <div className="rounded-lg border border-card-border bg-card/40 p-4 text-center">
            <div className="text-2xl font-bold text-foreground">{data.seatCounts.senate}</div>
            <div className="text-sm text-muted">
              {COUNTRY_CONFIGS[data.countryId]?.legislature.upperChamber?.shortName ?? "Senate"}
            </div>
          </div>
          <div className="rounded-lg border border-card-border bg-card/40 p-4 text-center">
            <div className="text-2xl font-bold text-foreground">{data.seatCounts.house}</div>
            <div className="text-sm text-muted">
              {COUNTRY_CONFIGS[data.countryId]?.legislature.lowerChamber.shortName ?? "House"}
            </div>
          </div>
          <div className="rounded-lg border border-card-border bg-card/40 p-4 text-center">
            <div className="text-2xl font-bold text-foreground">{data.seatCounts.governor}</div>
            <div className="text-sm text-muted">
              {COUNTRY_CONFIGS[data.countryId]?.officeTypes.find(
                (o) => o.isSubNational && o.isExecutive
              )?.labelPlural ?? "Governors"}
            </div>
          </div>
          <div className="rounded-lg border border-card-border bg-card/40 p-4 text-center">
            <div className="text-2xl font-bold text-foreground">{data.seatCounts.president}</div>
            <div className="text-sm text-muted">
              {COUNTRY_CONFIGS[data.countryId]?.executiveTitle ?? "President"}
            </div>
          </div>
          <div className="rounded-lg border border-card-border bg-card/40 p-4 text-center">
            <div className="text-2xl font-bold text-foreground">
              {data.seatCounts.vicePresident}
            </div>
            <div className="text-sm text-muted">
              {data.countryId === "US" ? "Vice President" : "Deputy Executive"}
            </div>
          </div>
        </div>
      </section>

      <footer className="mt-12 border-t border-card-border pt-6">
        <Link href="/wiki/parties" className="text-sm text-muted hover:text-primary">
          ← View all parties
        </Link>
      </footer>
    </div>
  );
}

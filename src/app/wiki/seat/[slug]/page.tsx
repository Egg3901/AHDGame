import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { notFound } from "next/navigation";
import { getSeatData } from "@/lib/wiki/seatData";
import { regionUrl } from "@/lib/urls";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const data = await getSeatData(slug);
  if (!data) return { title: "Not Found", robots: { index: false, follow: false } };
  return {
    title: `${data.title} | Wiki | A House Divided`,
    description: `Current officeholders for ${data.title}`,
    robots:
      data.holders.length === 0 ? { index: false, follow: true } : { index: true, follow: true },
  };
}

export default async function WikiSeatPage({ params }: PageProps) {
  const { slug } = await params;
  const data = await getSeatData(slug);
  if (!data) notFound();

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <nav className="mb-6 flex items-center gap-2 text-sm text-muted">
        <Link href="/wiki" className="hover:text-foreground">
          Wiki
        </Link>
        <span aria-hidden>/</span>
        <Link href="/wiki#seats" className="hover:text-foreground">
          Seats
        </Link>
        <span aria-hidden>/</span>
        <span className="text-foreground">{data.title}</span>
      </nav>

      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">{data.title}</h1>
        <p className="mt-2 text-muted">
          {data.type === "governor" &&
            "The governor is the chief executive of the state, with significant powers over appointments and legislation."}
          {data.type === "senate" &&
            `U.S. Senator, Class ${data.senateClass}. Each state has two senators in staggered classes; this seat is up for election every six years.`}
          {data.type === "house" &&
            `${data.houseSeatCount ?? 0} U.S. House seat(s). Representatives serve two-year terms; all seats in a state are contested together.`}
        </p>
      </header>

      <section className="rounded-xl border border-card-border bg-card/60 p-6">
        <h2 className="mb-4 text-xl font-semibold text-foreground">Current Officeholder(s)</h2>
        {data.holders.length === 0 ? (
          <div className="rounded-lg border border-dashed border-card-border bg-card/40 p-6 text-center">
            <p className="font-medium text-muted">Vacant</p>
            <p className="mt-1 text-sm text-muted">
              {data.type === "governor"
                ? "No governor has been elected yet. Governor elections run every 4 years (192 hours) per state."
                : data.type === "senate"
                  ? "This Senate seat has not been filled. Senate elections run every 6 years (288 hours) per class."
                  : "House seats are filled through elections. House elections run every 2 years (96 hours) per state."}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {data.holders.map((h, i) => (
              <div
                key={h.id || i}
                className="flex items-center gap-4 rounded-lg border border-card-border bg-card/40 p-4"
              >
                <Avatar
                  url={h.avatarUrl}
                  name={h.name}
                  size="h-14 w-14"
                  borderKey={h.borderKey}
                  tintColor={h.tintColor}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {h.profileHref ? (
                      <Link
                        href={h.profileHref}
                        className="font-semibold text-foreground hover:text-primary"
                      >
                        {h.name}
                      </Link>
                    ) : (
                      <span className="font-semibold text-foreground">{h.name}</span>
                    )}
                    {h.partyAbbreviation && data.stateId && (
                      <span
                        className="rounded px-1.5 py-0.5 text-xs font-medium"
                        style={{
                          backgroundColor: (h.partyColor ?? "#888") + "30",
                          color: h.partyColor ?? "#888",
                        }}
                      >
                        {h.partyAbbreviation}-{data.stateId}
                      </span>
                    )}
                    {h.isNPP && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted">NPP</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <footer className="mt-12 border-t border-card-border pt-6">
        <Link
          href={regionUrl(data.countryId ?? "US", data.stateId)}
          className="text-sm text-muted hover:text-primary"
        >
          ← View {data.stateName} state page
        </Link>
      </footer>
    </div>
  );
}

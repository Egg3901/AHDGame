import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { notFound } from "next/navigation";
import { getLeadershipData } from "@/lib/wiki/leadershipData";
import { LEADERSHIP_FLAVOR } from "@/lib/wiki/leadershipFlavor";
import type { LeadershipRole } from "@/lib/db/types";

interface PageProps {
  params: Promise<{ role: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { role } = await params;
  const data = await getLeadershipData(role);
  if (!data) return { title: "Not Found" };
  return {
    title: `${data.label} | Wiki | A House Divided`,
    description: `Current holder of ${data.label} in Congress`,
  };
}

export default async function WikiLeadershipPage({ params }: PageProps) {
  const { role } = await params;
  const data = await getLeadershipData(role);
  if (!data) notFound();

  const { holder } = data;
  const flavor = LEADERSHIP_FLAVOR[data.role as LeadershipRole];

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <nav className="mb-6 flex items-center gap-2 text-sm text-muted">
        <Link href="/wiki" className="hover:text-foreground">
          Wiki
        </Link>
        <span aria-hidden>/</span>
        <Link href="/wiki#leadership" className="hover:text-foreground">
          Leadership
        </Link>
        <span aria-hidden>/</span>
        <span className="text-foreground">{data.label}</span>
      </nav>

      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">{data.label}</h1>
        <p className="mt-2 text-muted">
          {data.chamber === "house" ? "House of Representatives" : "Senate"} leadership position
        </p>
      </header>

      {flavor && (
        <section className="mb-8 rounded-xl border border-card-border bg-card/60 p-6">
          <h2 className="mb-3 text-lg font-semibold text-foreground">About This Role</h2>
          <p className="text-muted leading-relaxed">{flavor.blurb}</p>
          <h3 className="mt-4 mb-2 text-sm font-medium text-foreground">Key Responsibilities</h3>
          <ul className="list-inside list-disc space-y-1 text-sm text-muted">
            {flavor.responsibilities.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-card-border bg-card/60 p-6">
        <h2 className="mb-4 text-xl font-semibold text-foreground">Current Holder</h2>
        <div className="flex items-center gap-4 rounded-lg border border-card-border bg-card/40 p-4">
          <Avatar
            url={holder.avatarUrl}
            name={holder.name}
            size="h-14 w-14"
            borderKey={holder.borderKey}
            tintColor={holder.tintColor}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {holder.profileHref ? (
                <Link
                  href={holder.profileHref}
                  className="font-semibold text-foreground hover:text-primary"
                >
                  {holder.name}
                </Link>
              ) : (
                <span className="font-semibold text-foreground">{holder.name}</span>
              )}
              {holder.partyName && holder.partyName !== "—" && (
                <span
                  className="rounded px-1.5 py-0.5 text-xs font-medium"
                  style={{
                    backgroundColor: holder.partyColor + "30",
                    color: holder.partyColor,
                  }}
                >
                  {holder.partyName}
                </span>
              )}
              {holder.state && <span className="text-sm text-muted">({holder.state})</span>}
            </div>
          </div>
        </div>
      </section>

      <footer className="mt-12 border-t border-card-border pt-6">
        <Link href="/wiki/congress" className="text-sm text-muted hover:text-primary">
          ← View Congress & leadership
        </Link>
      </footer>
    </div>
  );
}

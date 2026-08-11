import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/lib/mongodb";
import { publicPageMetadata } from "@/lib/siteMetadata";
import type { PatreonTier, User } from "@/lib/db/types";
import { isPatreonActive } from "@/lib/db/types";

export const metadata: Metadata = publicPageMetadata({
  title: "Supporter Wall | A House Divided",
  description:
    "The players whose support keeps A House Divided running. Thank you to every Supporter, Supporter+, and Supporter++ member.",
  pathname: "/supporters",
});

export const dynamic = "force-dynamic";

interface WallEntry {
  name: string;
  since: Date | null;
}

const TIER_SECTIONS: { tier: Exclude<PatreonTier, null>; label: string; blurb: string }[] = [
  {
    tier: "supporter-plus-plus",
    label: "Supporter++",
    blurb: "The top tier. These players carry the servers on their backs.",
  },
  {
    tier: "supporter-plus",
    label: "Supporter+",
    blurb: "Dedicated backers who keep new features shipping.",
  },
  {
    tier: "supporter",
    label: "Supporter",
    blurb: "Every subscription helps keep the simulation running around the clock.",
  },
];

async function loadWall(): Promise<Record<string, WallEntry[]>> {
  const db = await getDb();
  const users = await db
    .collection<User>("users")
    .find({
      supporterWallName: { $type: "string", $ne: "" },
      patreonTier: { $in: ["supporter", "supporter-plus", "supporter-plus-plus"] },
    })
    .project<Pick<User, "supporterWallName" | "patreonTier" | "patreonExpiresAt" | "patreonSince">>(
      { supporterWallName: 1, patreonTier: 1, patreonExpiresAt: 1, patreonSince: 1 }
    )
    .toArray();

  const byTier: Record<string, WallEntry[]> = {};
  for (const u of users) {
    const tier = u.patreonTier ?? null;
    if (!isPatreonActive(tier, u.patreonExpiresAt ?? null)) continue;
    if (!u.supporterWallName) continue;
    (byTier[tier as string] ??= []).push({
      name: u.supporterWallName,
      since: u.patreonSince ?? null,
    });
  }
  for (const list of Object.values(byTier)) {
    list.sort((a, b) => (a.since?.getTime() ?? Infinity) - (b.since?.getTime() ?? Infinity));
  }
  return byTier;
}

export default async function SupporterWallPage() {
  const wall = await loadWall();

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Supporter Wall</h1>
          <p className="mt-2 text-sm text-muted">
            The players who keep A House Divided online. Thank you.
          </p>
        </div>

        <div className="space-y-6">
          {TIER_SECTIONS.map((section) => {
            const entries = wall[section.tier] ?? [];
            return (
              <section
                key={section.tier}
                className="rounded-xl border border-card-border bg-card p-6"
              >
                <h2 className="text-xl font-semibold text-foreground">{section.label}</h2>
                <p className="mt-1 text-sm text-muted">{section.blurb}</p>
                {entries.length === 0 ? (
                  <p className="mt-4 text-sm text-muted">
                    No names on this part of the wall yet. Supporters choose a wall name from their
                    settings.
                  </p>
                ) : (
                  <ul className="mt-4 flex flex-wrap gap-2">
                    {entries.map((entry, i) => (
                      <li
                        key={`${entry.name}-${i}`}
                        className="rounded-full border border-card-border bg-background px-3 py-1 text-sm text-foreground"
                      >
                        {entry.name}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>

        <p className="mt-8 text-sm text-muted">
          Want your name here?{" "}
          <Link href="/settings" className="text-primary hover:text-primary/80">
            Set a wall name in your settings
          </Link>{" "}
          after subscribing to any supporter tier.
        </p>
      </div>
    </div>
  );
}

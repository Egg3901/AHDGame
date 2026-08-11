import type { Metadata } from "next";
import Link from "next/link";
import { publicPageMetadata } from "@/lib/siteMetadata";

export const metadata: Metadata = publicPageMetadata({
  title: "Running for Office | A House Divided",
  description:
    "Strategy guides for running for office in A House Divided: US elections, UK parliamentary races, and Japanese Diet elections.",
  pathname: "/guides/running-for-office",
});

const OPTIONS = [
  {
    href: "/guides/running-for-office/us",
    label: "United States",
    description:
      "House, Senate, Governor, and State Legislature races. Covers FPTP and RCV, campaign upgrades, Political Influence, favorability, and the vote formula.",
    tags: ["FPTP / RCV", "Federal + State"],
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
        />
      </svg>
    ),
  },
  {
    href: "/guides/running-for-office/intl",
    label: "UK & Japan",
    description:
      "Parliamentary systems: MPs, Diet seats, proportional representation, snap elections, cabinet bills, and how government formation actually works.",
    tags: ["Parliamentary", "Proportional / FPTP"],
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  },
];

export default function RunningForOfficeIndexPage() {
  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-10">
        {/* Breadcrumb */}
        <nav className="mb-6 flex items-center gap-1.5 text-sm text-muted">
          <Link href="/guides" className="hover:text-foreground transition-colors">
            Guides
          </Link>
          <span>/</span>
          <span className="text-foreground">Running for Office</span>
        </nav>

        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Running for Office</h1>
          <p className="mt-2 text-sm text-muted">Choose your country to get started</p>
        </div>

        <div className="mb-8 space-y-4">
          <p className="text-sm text-muted leading-relaxed">
            Elections are the beating heart of A House Divided. Every seat in the simulation, from a
            US state legislature district to Prime Minister, is won at the ballot box against other
            players and NPC politicians, on a live clock where one real hour is one game week.
            Campaigns are fought with the same levers everywhere: build{" "}
            <strong className="text-foreground">favorability</strong> with the demographics that
            actually live in your district, raise and spend campaign funds on ads and ground game,
            bank <strong className="text-foreground">Political Influence</strong> to unlock bigger
            moves, and time your push so you peak in the final weeks, not the first ones.
          </p>
          <p className="text-sm text-muted leading-relaxed">
            What differs is the system you&apos;re playing in. American races are candidate-first:
            you win a primary before you ever see the general, and first-past-the-post (or
            ranked-choice in some states) decides the winner. Parliamentary races in the UK and
            Japan are party-first: your list position, coalition math, and the threat of snap
            elections matter as much as your personal polling. The two guides below walk through
            each path office-by-office: what it costs, what the vote formula rewards, and the
            mistakes that sink first campaigns.
          </p>
          <p className="text-sm text-muted leading-relaxed">
            New to the game entirely? Start with the{" "}
            <Link href="/wiki/first-campaign-walkthrough" className="text-primary hover:underline">
              First Campaign Walkthrough
            </Link>{" "}
            on the wiki, then come back here when you know which country you&apos;re playing.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {OPTIONS.map((opt) => (
            <Link
              key={opt.href}
              href={opt.href}
              className="group rounded-xl border border-card-border bg-card p-5 transition-all hover:border-primary/40 hover:shadow-md"
            >
              <div className="mb-3 flex items-start justify-between">
                <div className="rounded-lg border border-card-border bg-background p-2 text-muted transition-colors group-hover:text-primary">
                  {opt.icon}
                </div>
                <svg
                  className="h-4 w-4 text-muted opacity-0 transition-opacity group-hover:opacity-100"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </div>
              <h2 className="mb-1.5 font-semibold text-foreground">{opt.label}</h2>
              <p className="text-sm text-muted leading-relaxed">{opt.description}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {opt.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-card-border px-2 py-0.5 text-xs text-muted"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

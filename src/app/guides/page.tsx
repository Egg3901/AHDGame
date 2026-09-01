import type { Metadata } from "next";
import Link from "next/link";
import { publicPageMetadata } from "@/lib/siteMetadata";
import { AdSenseUnit } from "@/components/AdSenseUnit";

export const metadata: Metadata = publicPageMetadata({
  title: "Guides | A House Divided",
  description:
    "Strategy guides for A House Divided: run corporations, win elections in the US, UK, Soviet Union, and East Germany, invest in stocks, bonds, and forex, and navigate legislation and parties in a persistent hourly simulation.",
  pathname: "/guides",
});

const GUIDES = [
  {
    href: "/guides/corporations",
    title: "Running a Corporation",
    description:
      "How to found, expand, and profit from your corporation. Covers sector focus, margin modifiers, commodity markets, sprawl, shares, and bonds.",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
        />
      </svg>
    ),
    tags: ["Economy", "Strategy"],
  },
  {
    href: "/guides/running-for-office",
    title: "Running for Office",
    description:
      "How to declare candidacy, survive the primary, and win a general election. Covers Political Influence, campaign upgrades, favorability, and what the vote formula actually rewards.",
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
    tags: ["Politics", "Strategy"],
  },
  {
    href: "/guides/investing",
    title: "Investing",
    description:
      "How to profit from stocks, forex, and sovereign bonds. Covers share price mechanics, dividend strategies, currency exchange tiers, bond pricing, and how interest rates connect everything.",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"
        />
      </svg>
    ),
    tags: ["Economy", "Finance"],
  },
  {
    href: "/guides/bonds",
    title: "Bonds",
    description:
      "How bonds work from the ground up - face value, coupons, maturity, the price/rate relationship, sovereign vs corporate bonds, credit ratings, and defaults.",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
    ),
    tags: ["Finance", "Economy"],
  },
  {
    href: "/guides/commodities",
    title: "Commodities",
    description:
      "How the 22-commodity market works - supply/demand pricing, margin effects, what every sector produces and consumes, operating strategies, and chain dependencies.",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
        />
      </svg>
    ),
    tags: ["Economy", "Corporations"],
  },
  {
    href: "/guides/forex",
    title: "Currency Exchange (Forex)",
    description:
      "How exchange rates move, trading tiers, volume pressure, and cross-currency strategies.",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
    tags: ["Finance", "Economy"],
  },
  {
    href: "/guides/planned-economies",
    title: "Planned / Command Economies",
    description:
      "How USSR, China, and Eastern-bloc planned economies differ from market rules: fixed FX, administered prices, soft budgets, shortage and overhang, and dual-track transitions.",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
        />
      </svg>
    ),
    tags: ["Economy", "Strategy"],
  },
  {
    href: "/supporters",
    title: "Supporter Wall",
    description:
      "The players whose support keeps A House Divided running. See every Supporter, Supporter+, and Supporter++ member on the wall.",
    icon: (
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
        />
      </svg>
    ),
    tags: ["Community"],
  },
];

export default function GuidesHubPage() {
  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Guides</h1>
          <p className="mt-2 text-sm text-muted">In-depth strategy guides for A House Divided</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {GUIDES.map((guide) => (
            <Link
              key={guide.href}
              href={guide.href}
              className="group rounded-xl border border-card-border bg-card p-5 transition-all hover:border-primary/40 hover:shadow-md"
            >
              <div className="mb-3 flex items-start justify-between">
                <div className="rounded-lg border border-card-border bg-background p-2 text-muted transition-colors group-hover:text-primary">
                  {guide.icon}
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
              <h2 className="mb-1.5 font-semibold text-foreground">{guide.title}</h2>
              <p className="text-sm text-muted leading-relaxed">{guide.description}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {guide.tags.map((tag) => (
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

        <AdSenseUnit
          slot="ahd-guides-incontent"
          format="auto"
          className="min-h-[280px] sm:min-h-[90px] mt-6"
        />
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { publicPageMetadata } from "@/lib/siteMetadata";

export const metadata: Metadata = publicPageMetadata({
  title: "API Automation Guide | A House Divided",
  description:
    "What A House Divided API keys can and cannot automate: fund transfers, forex orders, donations, plus the security checklist and how to get started with a scoped key.",
  pathname: "/guides/api-automation",
});

export default function ApiAutomationGuidePage() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <nav className="mb-6 flex items-center gap-1.5 text-sm text-muted">
        <Link href="/guides" className="hover:text-foreground transition-colors">
          Guides
        </Link>
        <span>/</span>
        <span className="text-foreground">API Automation</span>
      </nav>

      <h1 className="text-3xl font-bold">API Automation Guide</h1>
      <p className="mt-2 text-sm text-muted">Last updated: August 30, 2026 (UTC)</p>

      <section className="mt-8 space-y-3 rounded-2xl border border-card-border bg-card/70 p-6">
        <h2 className="text-xl font-semibold">What this covers</h2>
        <p className="text-sm text-muted">
          A House Divided exposes a read API (world state, markets, elections, politicians) and a
          narrow set of write endpoints for money movement, so players can build Discord bots,
          trading dashboards, and portfolio trackers on top of the live simulation. This page covers
          what scoped keys are allowed to do and how to handle them safely. For the full endpoint
          reference (routes, parameters, response shapes, and example requests), see the{" "}
          <a
            className="text-primary underline"
            href="https://docs.lakesidegames.net/api/public-v1.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            complete API documentation
          </a>
          .
        </p>
      </section>

      <section className="mt-6 space-y-3 rounded-2xl border border-card-border bg-card/70 p-6">
        <h2 className="text-xl font-semibold">What you can read</h2>
        <p className="text-sm text-muted">
          Public-scope keys can read the live game clock, countries and regions, national metrics
          and budgets, governments, elections, legislation, referendums, international
          organizations, trade restrictions and flows, sovereign risk, historical economic and
          fiscal series, conflicts, corporations, stocks, bonds, commodities, funds, and forex.
        </p>
        <p className="text-sm text-muted">
          Start with <code>/api/public/v1/meta</code> for the machine-readable route catalog. The
          catalog is tested against the route tree, so it cannot silently omit an implemented v1
          endpoint. OpenAPI clients can load the complete contract from{" "}
          <code>/api/public/v1/openapi.json</code>.
        </p>
      </section>

      <section className="mt-8 space-y-3 rounded-2xl border border-card-border bg-card/70 p-6">
        <h2 className="text-xl font-semibold">What API keys can do</h2>
        <p className="text-sm text-muted">
          View endpoints accept any personal API key (public or private scope) sent in the{" "}
          <code>X-API-Key</code> header. Write endpoints require a <code>private</code> scope key.
        </p>
        <div className="mt-2 space-y-2">
          <p className="text-sm font-medium">Allowed via automation:</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            <li>Campaign donations</li>
            <li>Character-to-character fund transfers</li>
            <li>Forex limit orders and market exchanges</li>
            <li>Party and coalition fund transfers</li>
          </ul>
        </div>
        <div className="mt-2 space-y-2">
          <p className="text-sm font-medium">Not permitted via automation:</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            <li>Political actions (campaign, advertise, fundraise, polls, etc.)</li>
            <li>Economy attacks and sector captures</li>
            <li>Election endorsements</li>
            <li>Any endpoint that changes game-state beyond fund transfers</li>
          </ul>
        </div>
      </section>

      <section className="mt-6 space-y-3 rounded-2xl border border-card-border bg-card/70 p-6">
        <h2 className="text-xl font-semibold">Security checklist</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
          <li>Store keys in environment variables, never in public repos.</li>
          <li>Use one key per app or bot for easier revocation.</li>
          <li>Revoke keys immediately if leaked or shared accidentally.</li>
          <li>Treat full-access keys like your account password.</li>
        </ul>
      </section>

      <section className="mt-6 space-y-3 rounded-2xl border border-card-border bg-card/70 p-6">
        <h2 className="text-xl font-semibold">Getting started</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-muted">
          <li>Create a key from Settings → API Keys.</li>
          <li>Copy it once and save it in your bot/app secret store.</li>
          <li>
            For all API endpoints, send your key in the <code>X-API-Key</code> header.
          </li>
        </ol>
        <p className="text-sm">
          Return to{" "}
          <Link className="text-primary underline" href="/settings">
            Settings
          </Link>
          .
        </p>
      </section>
    </main>
  );
}

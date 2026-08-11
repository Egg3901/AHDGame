import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/siteMetadata";
import Link from "next/link";

export const metadata: Metadata = publicPageMetadata({
  title: "API Documentation | A House Divided",
  description:
    "A House Divided API documentation: endpoints, response shapes, authentication, and usage guidelines.",
  pathname: "/api-guide",
});

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="space-y-3">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-background px-1 font-mono text-primary text-xs">{children}</code>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-background p-4 font-mono text-xs text-muted overflow-x-auto whitespace-pre-wrap">
      {children}
    </div>
  );
}

function ParamTable({ rows }: { rows: { name: string; type: string; desc: string }[] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-card-border">
          <th className="py-1 pr-3 text-left text-muted">Param</th>
          <th className="py-1 pr-3 text-left text-muted">Type</th>
          <th className="py-1 text-left text-muted">Description</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name} className="border-b border-card-border">
            <td className="py-1 pr-3 font-mono text-primary">{r.name}</td>
            <td className="py-1 pr-3 text-muted">{r.type}</td>
            <td className="py-1 text-muted">{r.desc}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FieldTable({ rows }: { rows: { name: string; type: string; desc: string }[] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-card-border">
          <th className="py-1 pr-3 text-left text-muted">Field</th>
          <th className="py-1 pr-3 text-left text-muted">Type</th>
          <th className="py-1 text-left text-muted">Description</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name} className="border-b border-card-border">
            <td className="py-1 pr-3 font-mono text-primary">{r.name}</td>
            <td className="py-1 pr-3 text-muted">{r.type}</td>
            <td className="py-1 text-muted">{r.desc}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ApiGuidePage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-foreground">API Documentation</h1>
        <p className="mt-2 text-sm text-muted">
          Use the A House Divided API to build tools that read game data or automate fund transfers
          and forex trades. Generate keys in{" "}
          <Link href="/settings" className="text-primary underline">
            Settings &rarr; API Keys
          </Link>
          .
        </p>
      </div>

      {/* ── Usage Guidelines ── */}
      <Section id="guidelines" title="Usage & Anti-Abuse Guidelines">
        <ul className="text-sm text-muted space-y-2 list-disc list-inside">
          <li>
            <strong className="text-foreground">Rate limits are enforced.</strong> Exceeding them
            returns a <Code>429</Code> response with a <Code>Retry-After</Code> header. Back off and
            retry.
          </li>
          <li>
            <strong className="text-foreground">Cache responses when possible.</strong> Game state
            turns over every few minutes; polling faster than once per minute is unnecessary and may
            hit rate limits.
          </li>
          <li>
            <strong className="text-foreground">
              Do not create multiple keys to circumvent limits.
            </strong>{" "}
            All requests under your account count toward the same quota regardless of which key you
            use.
          </li>
          <li>
            <strong className="text-foreground">Private keys are secrets.</strong> Never commit them
            to source control, embed them in client-side code, or share them publicly. If a key is
            compromised, revoke it immediately in Settings.
          </li>
          <li>
            <strong className="text-foreground">
              Automated fund transfers must respect in-game rules.
            </strong>{" "}
            Cooldowns, minimums, same-country restrictions, and admin pauses apply identically to
            API requests. Attempting to bypass them will result in revocation of API access.
          </li>
          <li>
            <strong className="text-foreground">Abuse results in revocation.</strong> Repeated
            rate-limit violations, key sharing, or attempts to circumvent in-game restrictions will
            result in key revocation and possibly account-level API restrictions.
          </li>
        </ul>
      </Section>

      {/* ── Authentication ── */}
      <Section id="authentication" title="Authentication">
        <p className="text-sm text-muted">
          All API requests require authentication. Include your key in the appropriate header:
        </p>
        <div className="space-y-3 mt-3">
          <div className="rounded-lg border border-card-border bg-card/80 p-4">
            <p className="text-xs font-semibold text-foreground">Personal API Keys</p>
            <p className="mt-1 text-xs text-muted">
              Pass in the <Code>X-API-Key</Code> header. Tied to your user account.
            </p>
            <ul className="mt-2 space-y-1 text-xs text-muted list-disc list-inside">
              <li>
                <strong className="text-green-400">Public</strong> &mdash; Read-only access to all
                public endpoints. Cannot send funds or trade forex.
              </li>
              <li>
                <strong className="text-yellow-300">Private</strong> &mdash; All public endpoints +
                send campaign funds and trade forex. Treat like a password.
              </li>
            </ul>
          </div>
        </div>
        <CodeBlock>
          {`# Public key (read-only)
curl -H "X-API-Key: ahd_pub_..." \\
  https://ahousedividedgame.com/api/public/v1/game

# Private key (read + send)
curl -X POST -H "X-API-Key: ahd_priv_..." \\
  -H "Content-Type: application/json" \\
  -d '{"targetCharacterId":"...","amount":5000}' \\
  https://ahousedividedgame.com/api/v1/transfer`}
        </CodeBlock>
      </Section>

      {/* ── Key Prefixes ── */}
      <Section id="key-prefixes" title="Key Prefixes">
        <p className="text-sm text-muted">
          API keys have identifying prefixes so you can tell the type at a glance:
        </p>
        <ParamTable
          rows={[
            { name: "ahd_pub_", type: "string", desc: "Personal read-only key" },
            { name: "ahd_priv_", type: "string", desc: "Personal read + send funds/forex key" },
          ]}
        />
        <p className="mt-2 text-xs text-muted">
          You can have up to <strong>3 active keys</strong> per scope type. Token values are shown
          only once at creation.
        </p>
      </Section>

      {/* ── Rate Limits ── */}
      <Section id="rate-limits" title="Rate Limits">
        <ParamTable
          rows={[
            { name: "Public read", type: "60 req/min", desc: "Per key" },
            { name: "Fund transfers", type: "20 req/min", desc: "Per key" },
            { name: "Forex trades", type: "30 req/min", desc: "Per key" },
            { name: "Key management", type: "10 req/min", desc: "Create/revoke" },
          ]}
        />
        <p className="mt-2 text-xs text-muted">
          Rate-limited responses include a <Code>Retry-After</Code> header (in seconds).
        </p>
      </Section>

      {/* ── Public Endpoints ── */}
      <Section id="public-endpoints" title="Public Read Endpoints">
        <p className="text-sm text-muted">
          Accessible with any personal API key via the <Code>X-API-Key</Code> header.
        </p>

        {/* Game State */}
        <details className="mt-4 rounded-lg border border-card-border">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-foreground hover:bg-card/50">
            GET /api/public/v1/game
          </summary>
          <div className="px-4 pb-4 space-y-2">
            <p className="text-xs text-muted mt-2">Current game state and turn timing.</p>
            <FieldTable
              rows={[
                { name: "ok", type: "boolean", desc: "Always true on success" },
                { name: "found", type: "boolean", desc: "Whether game data was found" },
                { name: "currentTurn", type: "number", desc: "Current turn number" },
                { name: "gameDate", type: "string", desc: "In-game date (YYYY-MM-DD)" },
                {
                  name: "nextTurnAt",
                  type: "string|null",
                  desc: "ISO 8601 timestamp of next turn",
                },
                { name: "turnDurationMs", type: "number", desc: "Turn duration in milliseconds" },
              ]}
            />
          </div>
        </details>

        {/* Character list */}
        <details className="mt-2 rounded-lg border border-card-border">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-foreground hover:bg-card/50">
            GET /api/public/v1/character
          </summary>
          <div className="px-4 pb-4 space-y-2">
            <p className="text-xs text-muted mt-2">
              Search characters. Requires <Code>name</Code> or <Code>discordId</Code> query param.
              Alias: <Code>GET /api/public/v1/characterSearch</Code> (same params and response).
            </p>
            <ParamTable
              rows={[
                { name: "name", type: "string", desc: "Character name (partial match)" },
                {
                  name: "discordId",
                  type: "string",
                  desc: "Discord user ID",
                },
              ]}
            />
            <p className="text-xs font-semibold text-foreground mt-2">Response shape:</p>
            <FieldTable
              rows={[
                { name: "ok", type: "boolean", desc: "Always true" },
                { name: "found", type: "boolean", desc: "Whether matches were found" },
                { name: "characters", type: "array", desc: "List of matching characters" },
                { name: "characters[].id", type: "string", desc: "Character ObjectId" },
                { name: "characters[].name", type: "string", desc: "Display name" },
                { name: "characters[].bio", type: "string|null", desc: "Character biography" },
                { name: "characters[].countryId", type: "string|null", desc: "Home country code" },
                { name: "characters[].party", type: "string", desc: "Party name" },
                { name: "characters[].partyId", type: "string|null", desc: "Party ObjectId" },
                { name: "characters[].partyColor", type: "string", desc: "Hex color" },
                { name: "characters[].state", type: "string", desc: "Home state name" },
                { name: "characters[].stateCode", type: "string", desc: "Home state code" },
                { name: "characters[].position", type: "string", desc: "Current office/position" },
                { name: "characters[].politicalInfluence", type: "number", desc: "PI score" },
                { name: "characters[].nationalInfluence", type: "number", desc: "NPI score" },
                { name: "characters[].favorability", type: "number", desc: "Favorability rating" },
                { name: "characters[].campaignFunds", type: "number", desc: "Campaign treasury" },
                { name: "characters[].netWorth", type: "number", desc: "Total net worth" },
                {
                  name: "characters[].isCeo",
                  type: "boolean",
                  desc: "Whether CEO of a corporation",
                },
                { name: "characters[].profileUrl", type: "string", desc: "Relative profile URL" },
                {
                  name: "characters[].activeElection",
                  type: "object|null",
                  desc: "Current election info if running",
                },
              ]}
            />
          </div>
        </details>

        {/* Character detail */}
        <details className="mt-2 rounded-lg border border-card-border">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-foreground hover:bg-card/50">
            GET /api/public/v1/character/[id]
          </summary>
          <div className="px-4 pb-4 space-y-2">
            <p className="text-xs text-muted mt-2">
              Full character details by public sequential id (e.g. <Code>75</Code>) or ObjectId.
            </p>
            <p className="text-xs text-muted">
              Same field shape as the characters array entry above, with additional detail fields.
            </p>
            <FieldTable
              rows={[
                { name: "ok", type: "boolean", desc: "Always true" },
                { name: "found", type: "boolean", desc: "Whether the character exists" },
                {
                  name: "character",
                  type: "object",
                  desc: "Full character object (same shape as characters[] above)",
                },
              ]}
            />
          </div>
        </details>

        {/* Character career */}
        <details className="mt-2 rounded-lg border border-card-border">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-foreground hover:bg-card/50">
            GET /api/public/v1/character/[id]/career
          </summary>
          <div className="px-4 pb-4 space-y-2">
            <p className="text-xs text-muted mt-2">Character career history.</p>
            <FieldTable
              rows={[
                { name: "ok", type: "boolean", desc: "Always true" },
                { name: "found", type: "boolean", desc: "Whether the character exists" },
                { name: "characterId", type: "string", desc: "Character ObjectId" },
                { name: "characterName", type: "string", desc: "Character display name" },
                { name: "career", type: "array", desc: "Career entries" },
                {
                  name: "career[].type",
                  type: "string",
                  desc: "Entry type (election, appointment, etc.)",
                },
                { name: "career[].office", type: "string|null", desc: "Office held" },
                { name: "career[].party", type: "string|null", desc: "Party at time" },
                { name: "career[].fromState", type: "string|null", desc: "Start turn/term" },
                { name: "career[].toState", type: "string|null", desc: "End turn/term" },
              ]}
            />
          </div>
        </details>

        {/* Character achievements */}
        <details className="mt-2 rounded-lg border border-card-border">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-foreground hover:bg-card/50">
            GET /api/public/v1/character/[id]/achievements
          </summary>
          <div className="px-4 pb-4 space-y-2">
            <p className="text-xs text-muted mt-2">Achievements earned by a character.</p>
            <FieldTable
              rows={[
                { name: "ok", type: "boolean", desc: "Always true" },
                { name: "found", type: "boolean", desc: "Whether the character exists" },
                { name: "characterId", type: "string", desc: "Character ObjectId" },
                { name: "characterName", type: "string", desc: "Display name" },
                { name: "achievements", type: "array", desc: "Achievement list" },
                { name: "achievements[].id", type: "string", desc: "Achievement ID" },
                { name: "achievements[].name", type: "string|null", desc: "Display name" },
                {
                  name: "achievements[].description",
                  type: "string|null",
                  desc: "Description text",
                },
                { name: "achievements[].icon", type: "string|null", desc: "Emoji/icon" },
                { name: "achievements[].category", type: "string|null", desc: "Category" },
                {
                  name: "achievements[].isHidden",
                  type: "boolean",
                  desc: "Whether hidden from others",
                },
                {
                  name: "achievements[].earnedAt",
                  type: "string|null",
                  desc: "ISO 8601 timestamp",
                },
              ]}
            />
          </div>
        </details>

        {/* Party */}
        <details className="mt-2 rounded-lg border border-card-border">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-foreground hover:bg-card/50">
            GET /api/public/v1/party?id=ID&amp;country=CODE
          </summary>
          <div className="px-4 pb-4 space-y-2">
            <p className="text-xs text-muted mt-2">
              Party details. Both <Code>id</Code> and <Code>country</Code> params required.
            </p>
            <FieldTable
              rows={[
                { name: "ok", type: "boolean", desc: "Always true" },
                { name: "found", type: "boolean", desc: "Whether the party exists" },
                { name: "party.id", type: "string", desc: "Party ObjectId" },
                { name: "party.name", type: "string", desc: "Party name" },
                { name: "party.abbreviation", type: "string|null", desc: "Short name" },
                { name: "party.color", type: "string", desc: "Hex color" },
                { name: "party.economicPosition", type: "number", desc: "Economic axis position" },
                { name: "party.socialPosition", type: "number", desc: "Social axis position" },
                { name: "party.memberCount", type: "number", desc: "Active member count" },
                { name: "party.seatCount", type: "number", desc: "Legislative seats held" },
                { name: "party.treasury", type: "number", desc: "Party treasury balance" },
                { name: "party.chairName", type: "string|null", desc: "Party chair name" },
                { name: "party.topMembers", type: "array", desc: "Top 5 members by influence" },
              ]}
            />
          </div>
        </details>

        {/* Country */}
        <details className="mt-2 rounded-lg border border-card-border">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-foreground hover:bg-card/50">
            GET /api/public/v1/country
          </summary>
          <div className="px-4 pb-4 space-y-2">
            <p className="text-xs text-muted mt-2">List all countries.</p>
            <FieldTable
              rows={[
                { name: "ok", type: "boolean", desc: "Always true" },
                { name: "countries", type: "array", desc: "Array of { id, name, governmentType }" },
              ]}
            />
          </div>
        </details>

        {/* Country detail */}
        <details className="mt-2 rounded-lg border border-card-border">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-foreground hover:bg-card/50">
            GET /api/public/v1/country/[code]
          </summary>
          <div className="px-4 pb-4 space-y-2">
            <p className="text-xs text-muted mt-2">Country details by code (e.g. US, GB).</p>
            <FieldTable
              rows={[
                { name: "ok", type: "boolean", desc: "Always true" },
                { name: "found", type: "boolean", desc: "Whether the country exists" },
                { name: "countryId", type: "string", desc: "Country code" },
                { name: "name", type: "string", desc: "Country name" },
                {
                  name: "governmentType",
                  type: "string",
                  desc: "Regime type (e.g. presidential, parliamentary)",
                },
                { name: "population", type: "number|null", desc: "Population count" },
                {
                  name: "currentLeader",
                  type: "object|null",
                  desc: "{ name, party, profileUrl } or null",
                },
                { name: "legislatureComposition", type: "array", desc: "Seat breakdown by party" },
                { name: "legislatureComposition[].partyName", type: "string", desc: "Party name" },
                { name: "legislatureComposition[].seats", type: "number", desc: "Seats held" },
                {
                  name: "legislatureComposition[].seatPct",
                  type: "number",
                  desc: "Percentage of total",
                },
                {
                  name: "lastElectionCycle",
                  type: "number|null",
                  desc: "Last election cycle number",
                },
              ]}
            />
          </div>
        </details>

        {/* Country legislature */}
        <details className="mt-2 rounded-lg border border-card-border">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-foreground hover:bg-card/50">
            GET /api/public/v1/country/[code]/legislature
          </summary>
          <div className="px-4 pb-4 space-y-2">
            <p className="text-xs text-muted mt-2">Legislature details for a country.</p>
            <FieldTable
              rows={[
                { name: "ok", type: "boolean", desc: "Always true" },
                { name: "found", type: "boolean", desc: "Whether found" },
                { name: "countryId", type: "string", desc: "Country code" },
                { name: "chamber", type: "string", desc: "Chamber name" },
                { name: "totalSeats", type: "number", desc: "Total legislative seats" },
                { name: "composition", type: "array", desc: "Party seat breakdown" },
                { name: "pendingBills", type: "array", desc: "Bills awaiting vote" },
                { name: "pendingBills[].id", type: "string", desc: "Bill ObjectId" },
                { name: "pendingBills[].title", type: "string", desc: "Bill title" },
                { name: "pendingBills[].status", type: "string", desc: "Bill status" },
                { name: "recentlyPassed", type: "array", desc: "Recently passed bills" },
                { name: "recentlyPassed[].vote", type: "object", desc: "{ yes, no } vote tally" },
              ]}
            />
          </div>
        </details>

        {/* Country economy */}
        <details className="mt-2 rounded-lg border border-card-border">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-foreground hover:bg-card/50">
            GET /api/public/v1/country/[code]/economy
          </summary>
          <div className="px-4 pb-4 space-y-2">
            <p className="text-xs text-muted mt-2">Economic indicators for a country.</p>
            <FieldTable
              rows={[
                { name: "ok", type: "boolean", desc: "Always true" },
                { name: "found", type: "boolean", desc: "Whether found" },
                { name: "countryId", type: "string", desc: "Country code" },
                { name: "primeRate", type: "number|null", desc: "Current central bank rate" },
                { name: "inflation", type: "number|null", desc: "Current inflation rate" },
                { name: "gdpGrowth", type: "number|null", desc: "GDP growth rate" },
                {
                  name: "chair",
                  type: "object|null",
                  desc: "{ name, profileUrl } central bank chair",
                },
                { name: "rateHistory", type: "array", desc: "[{ turn, rate }] historical rates" },
                { name: "stockMarket", type: "object", desc: "Stock market summary" },
                { name: "stockMarket.totalMarketCap", type: "number", desc: "Total market cap" },
                { name: "stockMarket.change24h", type: "number", desc: "24h change percentage" },
              ]}
            />
          </div>
        </details>

        {/* Government */}
        <details className="mt-2 rounded-lg border border-card-border">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-foreground hover:bg-card/50">
            GET /api/public/v1/government?country=CODE
          </summary>
          <div className="px-4 pb-4 space-y-2">
            <p className="text-xs text-muted mt-2">
              Government overview. Requires <Code>country</Code> query param.
            </p>
            <FieldTable
              rows={[
                { name: "ok", type: "boolean", desc: "Always true" },
                { name: "found", type: "boolean", desc: "Whether found" },
                { name: "country", type: "string", desc: "Country code" },
                { name: "officials", type: "array", desc: "Government officials" },
                { name: "officials[].role", type: "string", desc: "Position title" },
                {
                  name: "officials[].characterName",
                  type: "string|null",
                  desc: "Office holder name",
                },
                { name: "officials[].party", type: "string|null", desc: "Party affiliation" },
                {
                  name: "officials[].section",
                  type: "string",
                  desc: '"executive" or "leadership"',
                },
                { name: "cabinet", type: "array", desc: "Cabinet members" },
                { name: "governmentFormation", type: "object", desc: "Varies by regime type" },
              ]}
            />
          </div>
        </details>

        {/* Elections list */}
        <details className="mt-2 rounded-lg border border-card-border">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-foreground hover:bg-card/50">
            GET /api/public/v1/elections?country=CODE
          </summary>
          <div className="px-4 pb-4 space-y-2">
            <p className="text-xs text-muted mt-2">
              Active elections. Requires <Code>country</Code> param; optional <Code>state</Code>.
            </p>
            <FieldTable
              rows={[
                { name: "ok", type: "boolean", desc: "Always true" },
                { name: "found", type: "boolean", desc: "Whether elections found" },
                { name: "elections", type: "array", desc: "List of elections" },
                { name: "elections[].id", type: "string", desc: "Election ObjectId" },
                {
                  name: "elections[].electionType",
                  type: "string",
                  desc: "Type (primary, general, etc.)",
                },
                { name: "elections[].state", type: "string", desc: "State code" },
                { name: "elections[].status", type: "string", desc: "Status (open, closed, etc.)" },
                { name: "elections[].candidates", type: "array", desc: "Candidate list" },
                {
                  name: "elections[].candidates[].characterName",
                  type: "string",
                  desc: "Candidate name",
                },
                { name: "elections[].candidates[].party", type: "string", desc: "Party name" },
                {
                  name: "elections[].candidates[].isNPP",
                  type: "boolean",
                  desc: "Non-party member",
                },
              ]}
            />
          </div>
        </details>

        {/* Election detail */}
        <details className="mt-2 rounded-lg border border-card-border">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-foreground hover:bg-card/50">
            GET /api/public/v1/elections/[id]
          </summary>
          <div className="px-4 pb-4 space-y-2">
            <p className="text-xs text-muted mt-2">
              Detailed election info including candidates, votes, and phases.
            </p>
            <FieldTable
              rows={[
                { name: "ok", type: "boolean", desc: "Always true" },
                { name: "found", type: "boolean", desc: "Whether found" },
                { name: "election", type: "object", desc: "Full election data" },
                { name: "election.id", type: "string", desc: "Election ObjectId" },
                { name: "election.electionType", type: "string", desc: "Type" },
                { name: "election.status", type: "string", desc: "Current status" },
                { name: "election.totalSeats", type: "number", desc: "Seats contested" },
                {
                  name: "phase",
                  type: "object",
                  desc: "{ inPrimary, inGeneral, isUpcoming, isEnded }",
                },
                { name: "incumbent", type: "object|null", desc: "{ name, party } or null" },
                { name: "candidates", type: "array", desc: "Full candidate list with details" },
                { name: "votes", type: "object|null", desc: "Vote tallies and snapshots" },
              ]}
            />
          </div>
        </details>

        {/* News */}
        <details className="mt-2 rounded-lg border border-card-border">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-foreground hover:bg-card/50">
            GET /api/public/v1/news?limit=N&amp;category=CAT
          </summary>
          <div className="px-4 pb-4 space-y-2">
            <p className="text-xs text-muted mt-2">
              News feed. Optional <Code>limit</Code> and <Code>category</Code> params.
            </p>
            <FieldTable
              rows={[
                { name: "ok", type: "boolean", desc: "Always true" },
                { name: "found", type: "boolean", desc: "Whether posts found" },
                { name: "posts", type: "array", desc: "News posts" },
                { name: "posts[].id", type: "string", desc: "Post ObjectId" },
                { name: "posts[].title", type: "string|null", desc: "Headline" },
                { name: "posts[].content", type: "string|null", desc: "Body text" },
                { name: "posts[].authorName", type: "string|null", desc: "Author" },
                { name: "posts[].isSystem", type: "boolean", desc: "System-generated post" },
                { name: "posts[].category", type: "string|null", desc: "Category tag" },
                { name: "posts[].countryId", type: "string|null", desc: "Related country" },
                { name: "posts[].createdAt", type: "string|null", desc: "ISO 8601 timestamp" },
              ]}
            />
          </div>
        </details>

        {/* Legislation */}
        <details className="mt-2 rounded-lg border border-card-border">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-foreground hover:bg-card/50">
            GET /api/public/v1/legislation?country=CODE&amp;status=pending|passed|failed&amp;limit=N
          </summary>
          <div className="px-4 pb-4 space-y-2">
            <p className="text-xs text-muted mt-2">Bills and votes. Optional filters.</p>
            <FieldTable
              rows={[
                { name: "ok", type: "boolean", desc: "Always true" },
                { name: "found", type: "boolean", desc: "Whether bills found" },
                { name: "bills", type: "array", desc: "Legislation list" },
                { name: "bills[].id", type: "string", desc: "Bill ObjectId" },
                { name: "bills[].title", type: "string", desc: "Bill title" },
                { name: "bills[].sponsor", type: "string|null", desc: "Sponsor name" },
                { name: "bills[].status", type: "string", desc: "pending, passed, or failed" },
                { name: "bills[].vote", type: "object", desc: "{ yes, no, abstain }" },
                { name: "bills[].effects", type: "array", desc: "[{ metric, direction }]" },
              ]}
            />
          </div>
        </details>

        {/* Market */}
        <details className="mt-2 rounded-lg border border-card-border">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-foreground hover:bg-card/50">
            GET /api/public/v1/market?type=SECTOR&amp;country=CODE&amp;page=N
          </summary>
          <div className="px-4 pb-4 space-y-2">
            <p className="text-xs text-muted mt-2">
              Stock market data. <Code>type</Code> param required. Pass <Code>view=share</Code> for
              shares, <Code>view=unowned</Code> for unowned sectors.
            </p>
            <FieldTable
              rows={[
                { name: "ok", type: "boolean", desc: "Always true" },
                { name: "found", type: "boolean", desc: "Whether data found" },
                { name: "mode", type: "string", desc: '"share" or "unowned"' },
                { name: "sectorType", type: "string", desc: "Requested sector type" },
                { name: "page", type: "number", desc: "Current page" },
                { name: "totalPages", type: "number", desc: "Total pages" },
                { name: "companies|sectors", type: "array", desc: "Results (depends on mode)" },
              ]}
            />
          </div>
        </details>

        {/* Bonds */}
        <details className="mt-2 rounded-lg border border-card-border">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-foreground hover:bg-card/50">
            GET /api/public/v1/bonds?corp=NAME&amp;page=N
          </summary>
          <div className="px-4 pb-4 space-y-2">
            <p className="text-xs text-muted mt-2">
              Bond market data. Optional <Code>corp</Code> and <Code>page</Code> params.
            </p>
            <FieldTable
              rows={[
                { name: "ok", type: "boolean", desc: "Always true" },
                { name: "found", type: "boolean", desc: "Whether bonds found" },
                { name: "bonds", type: "array", desc: "Bond list" },
                { name: "bonds[].id", type: "string", desc: "Bond ObjectId" },
                {
                  name: "bonds[].couponRate",
                  type: "number",
                  desc: "Coupon rate (e.g. 0.05 = 5%)",
                },
                {
                  name: "bonds[].maturityLabel",
                  type: "string|null",
                  desc: "Maturity description",
                },
                { name: "bonds[].totalIssued", type: "number", desc: "Total bonds issued" },
                { name: "bonds[].marketPrice", type: "number", desc: "Current market price" },
                { name: "bonds[].yieldToMaturity", type: "number|null", desc: "YTM" },
                { name: "bonds[].defaulted", type: "boolean", desc: "Whether bond is in default" },
                {
                  name: "pagination",
                  type: "object",
                  desc: "{ page, perPage, totalCount, totalPages }",
                },
              ]}
            />
          </div>
        </details>

        {/* Corporations list */}
        <details className="mt-2 rounded-lg border border-card-border">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-foreground hover:bg-card/50">
            GET /api/public/v1/corporations
          </summary>
          <div className="px-4 pb-4 space-y-2">
            <p className="text-xs text-muted mt-2">List all corporations.</p>
            <FieldTable
              rows={[
                { name: "ok", type: "boolean", desc: "Always true" },
                {
                  name: "corporations",
                  type: "array",
                  desc: "List of { id, name, sequentialId, type, countryId }",
                },
              ]}
            />
          </div>
        </details>

        {/* Corporation detail */}
        <details className="mt-2 rounded-lg border border-card-border">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-foreground hover:bg-card/50">
            GET /api/public/v1/corporation?name=X&amp;id=N
          </summary>
          <div className="px-4 pb-4 space-y-2">
            <p className="text-xs text-muted mt-2">
              Corporation details. Requires <Code>name</Code> or <Code>id</Code>. Note:{" "}
              <Code>id</Code> is the corporation&apos;s <Code>sequentialId</Code> (e.g. 112), not
              the Mongo ObjectId.
            </p>
            <FieldTable
              rows={[
                { name: "ok", type: "boolean", desc: "Always true" },
                { name: "found", type: "boolean", desc: "Whether found" },
                { name: "id", type: "string", desc: "Corporation ObjectId" },
                { name: "name", type: "string", desc: "Corporation name" },
                { name: "type", type: "string", desc: "Corporation type" },
                { name: "typeLabel", type: "string", desc: "Human-readable type" },
                { name: "ceo", type: "object|null", desc: "{ name, profileUrl }" },
                { name: "financials", type: "object", desc: "Revenue, income, costs, dividends" },
                {
                  name: "balanceSheet",
                  type: "object",
                  desc: "{ cashOnHand, marketCapitalization, totalDebt }",
                },
                {
                  name: "shareStructure",
                  type: "object",
                  desc: "Shares, price, float, shareholders",
                },
                { name: "creditRating", type: "object", desc: "Rating, score, components" },
                { name: "bonds", type: "array", desc: "Corporate bonds" },
                { name: "sectors", type: "array", desc: "Operational sectors" },
              ]}
            />
          </div>
        </details>

        {/* Leaderboard */}
        <details className="mt-2 rounded-lg border border-card-border">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-foreground hover:bg-card/50">
            GET /api/public/v1/leaderboard?country=CODE&amp;metric=METRIC&amp;limit=N
          </summary>
          <div className="px-4 pb-4 space-y-2">
            <p className="text-xs text-muted mt-2">
              Player rankings. Metrics: <Code>npi</Code>, <Code>pi</Code>, <Code>favorability</Code>
              , <Code>funds</Code>, <Code>actions</Code>.
            </p>
            <FieldTable
              rows={[
                { name: "ok", type: "boolean", desc: "Always true" },
                { name: "found", type: "boolean", desc: "Whether found" },
                { name: "metric", type: "string", desc: "Requested metric" },
                { name: "characters", type: "array", desc: "Ranked characters" },
                { name: "characters[].rank", type: "number", desc: "Position" },
                { name: "characters[].name", type: "string", desc: "Character name" },
                { name: "characters[].party", type: "string", desc: "Party name" },
                { name: "characters[].funds", type: "number", desc: "Campaign funds" },
                { name: "characters[].politicalInfluence", type: "number", desc: "PI score" },
                { name: "characters[].profileUrl", type: "string", desc: "Profile link" },
              ]}
            />
          </div>
        </details>
      </Section>

      {/* ── Private Endpoints ── */}
      <Section id="private-endpoints" title="Private Endpoints (Send Funds & Forex)">
        <p className="text-sm text-muted">
          Require a <strong className="text-yellow-300">private</strong> personal API key. All
          in-game restrictions apply identically to API requests.
        </p>

        <details className="mt-4 rounded-lg border border-card-border">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-foreground hover:bg-card/50">
            POST /api/v1/transfer
          </summary>
          <div className="px-4 pb-4 space-y-2">
            <p className="text-xs text-muted mt-2">Send campaign funds to another character.</p>
            <p className="text-xs font-semibold text-foreground mt-2">Request body:</p>
            <ParamTable
              rows={[
                { name: "targetCharacterId", type: "string", desc: "Recipient character ObjectId" },
                {
                  name: "amount",
                  type: "number",
                  desc: "Amount in your character's home currency (e.g. ¥, £), the same unit as your in-game balance (min 1000, integer)",
                },
              ]}
            />
            <p className="text-xs font-semibold text-foreground mt-3">Response:</p>
            <FieldTable
              rows={[
                { name: "success", type: "boolean", desc: "true" },
                { name: "amount", type: "number", desc: "Amount transferred (home currency)" },
                {
                  name: "currency",
                  type: "string",
                  desc: 'Sender home currency code (e.g. "CNY")',
                },
                {
                  name: "senderRemainingFunds",
                  type: "number",
                  desc: "Sender campaign balance after transfer (home currency)",
                },
                { name: "targetName", type: "string", desc: "Recipient character name" },
              ]}
            />
            <p className="text-xs font-semibold text-foreground mt-3">Restrictions:</p>
            <ul className="text-xs text-muted list-disc list-inside space-y-1">
              <li>Minimum transfer: 1,000 (home currency)</li>
              <li>Sender and target must be in the same country</li>
              <li>Cannot transfer to yourself</li>
              <li>Must have sufficient campaign funds</li>
              <li>Transfers may be paused by admins (returns 403)</li>
            </ul>
          </div>
        </details>

        <details className="mt-2 rounded-lg border border-card-border">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-foreground hover:bg-card/50">
            POST /api/v1/forex/exchange
          </summary>
          <div className="px-4 pb-4 space-y-2">
            <p className="text-xs text-muted mt-2">Execute a forex market order.</p>
            <p className="text-xs font-semibold text-foreground mt-2">Request body:</p>
            <ParamTable
              rows={[
                { name: "fromCurrency", type: "string", desc: 'Source currency code (e.g. "USD")' },
                { name: "toCurrency", type: "string", desc: 'Target currency code (e.g. "GBP")' },
                { name: "amount", type: "number", desc: "Amount in source currency (must be > 0)" },
              ]}
            />
            <p className="text-xs font-semibold text-foreground mt-3">Response:</p>
            <FieldTable
              rows={[
                { name: "success", type: "boolean", desc: "true" },
                { name: "trade.fromCurrency", type: "string", desc: "Source currency" },
                { name: "trade.toCurrency", type: "string", desc: "Target currency" },
                { name: "trade.fromAmount", type: "number", desc: "Amount deducted" },
                { name: "trade.toAmount", type: "number", desc: "Amount received" },
                { name: "trade.effectiveRate", type: "number", desc: "Effective exchange rate" },
                {
                  name: "trade.spreadCharged",
                  type: "number",
                  desc: "0.275% spread (50% destroyed, 50% to central bank)",
                },
              ]}
            />
            <p className="text-xs font-semibold text-foreground mt-3">Restrictions:</p>
            <ul className="text-xs text-muted list-disc list-inside space-y-1">
              <li>Cannot trade a currency for itself</li>
              <li>Forex must be enabled on the server</li>
              <li>Must have sufficient funds in source currency</li>
              <li>Character must exist and be in an active country</li>
            </ul>
          </div>
        </details>
      </Section>

      {/* ── Error Responses ── */}
      <Section id="errors" title="Error Responses">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border">
                <th className="py-2 pr-4 text-left text-xs text-muted">Status</th>
                <th className="py-2 pr-4 text-left text-xs text-muted">Code</th>
                <th className="py-2 text-left text-xs text-muted">Meaning</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-card-border">
                <td className="py-2 pr-4 text-xs">401</td>
                <td className="py-2 pr-4 text-xs font-mono">missing / invalid</td>
                <td className="py-2 text-xs text-muted">No API key, or key not found/revoked</td>
              </tr>
              <tr className="border-b border-card-border">
                <td className="py-2 pr-4 text-xs">403</td>
                <td className="py-2 pr-4 text-xs font-mono">insufficient scope</td>
                <td className="py-2 text-xs text-muted">Public key used on a private endpoint</td>
              </tr>
              <tr className="border-b border-card-border">
                <td className="py-2 pr-4 text-xs">403</td>
                <td className="py-2 pr-4 text-xs font-mono">Transfers are paused</td>
                <td className="py-2 text-xs text-muted">
                  Admin has temporarily paused fund transfers
                </td>
              </tr>
              <tr className="border-b border-card-border">
                <td className="py-2 pr-4 text-xs">403</td>
                <td className="py-2 pr-4 text-xs font-mono">
                  Currency exchange is not yet enabled
                </td>
                <td className="py-2 text-xs text-muted">Forex is disabled on this server</td>
              </tr>
              <tr className="border-b border-card-border">
                <td className="py-2 pr-4 text-xs">429</td>
                <td className="py-2 pr-4 text-xs font-mono">rate_limited</td>
                <td className="py-2 text-xs text-muted">
                  Too many requests &mdash; check Retry-After header
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── Quick-Start: Scripting ── */}
      <Section id="scripting" title="Quick-Start: Scripting &amp; Automation">
        <p className="text-sm text-muted">
          Generate keys in{" "}
          <Link href="/settings" className="text-primary underline">
            Settings &rarr; API Keys
          </Link>
          , or use the API directly:
        </p>
        <CodeBlock>
          {`# Create a public key (read-only)
curl -X POST https://ahousedividedgame.com/api/settings/user-api-keys \\
  -H "Content-Type: application/json" \\
  -b "your-session-cookie" \\
  -d '{"name":"My Dashboard","scope":"public"}'

# Create a private key (read + send)
curl -X POST https://ahousedividedgame.com/api/settings/user-api-keys \\
  -H "Content-Type: application/json" \\
  -b "your-session-cookie" \\
  -d '{"name":"Auto Transfer","scope":"private"}'

# List your keys
curl https://ahousedividedgame.com/api/settings/user-api-keys \\
  -b "your-session-cookie"

# Revoke a key
curl -X DELETE https://ahousedividedgame.com/api/settings/user-api-keys \\
  -H "Content-Type: application/json" \\
  -b "your-session-cookie" \\
  -d '{"keyId":"683f..."}'`}
        </CodeBlock>
        <p className="text-xs text-yellow-300 mt-2">
          The full token is only shown once at creation. Store it securely.
        </p>

        <h3 className="text-sm font-semibold text-foreground mt-6">Python</h3>
        <CodeBlock>
          {`import os, requests

BASE = "https://ahousedividedgame.com"
headers = {"X-API-Key": os.environ["AHD_API_KEY"]}

# Read public data (any key)
game = requests.get(f"{BASE}/api/public/v1/game", headers=headers).json()
print(f"Turn {game['currentTurn']}")

# Send funds (requires private key)
if "priv" in os.environ["AHD_API_KEY"]:
    res = requests.post(
        f"{BASE}/api/v1/transfer",
        headers={**headers, "Content-Type": "application/json"},
        json={"targetCharacterId": "507f1f77bcf86cd799439011", "amount": 5000},
    ).json()
    print(res.get("success") and f"Sent {res['amount']} to {res['targetName']}" or res.get("error"))`}
        </CodeBlock>

        <h3 className="text-sm font-semibold text-foreground mt-6">Bash (cron-friendly)</h3>
        <CodeBlock>
          {`export AHD_API_KEY="ahd_pub_your_key_here"

# Fetch game state
curl -s -H "X-API-Key: $AHD_API_KEY" \\
  https://ahousedividedgame.com/api/public/v1/game | jq .

# Check character count
curl -s -H "X-API-Key: $AHD_API_KEY" \\
  "https://ahousedividedgame.com/api/public/v1/character?name=Smith" | jq '.characters | length'`}
        </CodeBlock>
      </Section>

      {/* ── Quick-Start: Discord Bot ── */}
      <Section id="discord-bot" title="Quick-Start: Discord Bot">
        <p className="text-sm text-muted">
          To build a personal automation bot that sends funds or trades forex, use a personal API
          key with the <Code>X-API-Key</Code> header:
        </p>
        <ol className="text-sm text-muted space-y-2 list-decimal list-inside mt-2">
          <li>
            Go to{" "}
            <Link href="/settings" className="text-primary underline">
              Settings &rarr; API Keys
            </Link>{" "}
            and create a <strong className="text-yellow-300">private</strong> key (e.g.{" "}
            &quot;Discord Bot&quot;)
          </li>
          <li>Copy the key &mdash; it&apos;s only shown once</li>
          <li>
            In your bot code, use the key in the <Code>X-API-Key</Code> header
          </li>
          <li>Call the transfer or forex endpoint as shown in the scripting examples above</li>
        </ol>
        <h3 className="text-sm font-semibold text-foreground mt-6">Node.js / Discord.js</h3>
        <CodeBlock>
          {`const BASE = "https://ahousedividedgame.com";
const headers = {
  "X-API-Key": process.env.AHD_API_KEY,
  "Content-Type": "application/json",
};

// Read public data
const game = await fetch(\`\${BASE}/api/public/v1/game\`, { headers })
  .then(r => r.json());

// Send funds
const res = await fetch(\`\${BASE}/api/v1/transfer\`, {
  method: "POST",
  headers,
  body: JSON.stringify({ targetCharacterId: targetId, amount: 5000 }),
}).then(r => r.json());

// Trade forex
const forex = await fetch(\`\${BASE}/api/v1/forex/exchange\`, {
  method: "POST",
  headers,
  body: JSON.stringify({ fromCurrency: "USD", toCurrency: "GBP", amount: 1000 }),
}).then(r => r.json());`}
        </CodeBlock>
      </Section>

      <div className="pt-4 text-center text-xs text-muted">
        <Link href="/settings" className="text-primary underline hover:text-primary/80">
          &larr; Back to Settings
        </Link>
      </div>
    </div>
  );
}

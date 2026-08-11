import type { Metadata } from "next";
import Link from "next/link";
import { publicPageMetadata } from "@/lib/siteMetadata";

export const metadata: Metadata = publicPageMetadata({
  title: "Running for Office (US) | A House Divided",
  description:
    "How to run for US office in A House Divided: eligibility, primaries, campaign strategy, vote mechanics, and what actually wins elections.",
  pathname: "/guides/running-for-office/us",
});

function SectionHeader({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="scroll-mt-4 text-xl font-bold tracking-tight text-foreground border-l-4 border-primary/60 pl-3"
    >
      {children}
    </h2>
  );
}

function SubHeader({ children }: { children: React.ReactNode }) {
  return <h3 className="font-semibold text-foreground">{children}</h3>;
}

function Callout({
  children,
  variant = "info",
}: {
  children: React.ReactNode;
  variant?: "info" | "warn" | "tip";
}) {
  const colors = {
    info: "border-primary/40 bg-primary/5",
    warn: "border-amber-500/40 bg-amber-500/5",
    tip: "border-emerald-500/40 bg-emerald-500/5",
  };
  return (
    <div
      className={`rounded-r-lg border-l-4 px-4 py-3 text-sm text-muted leading-relaxed ${colors[variant]}`}
    >
      {children}
    </div>
  );
}

function FormulaBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-card-border bg-background px-4 py-3 font-mono text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap">
      {children}
    </pre>
  );
}

const TOC_ITEMS = [
  { id: "eligibility", label: "Eligibility & Requirements" },
  { id: "races", label: "Choosing Your Race" },
  { id: "primary", label: "The Primary Phase" },
  { id: "general", label: "The General Phase" },
  { id: "vote-formula", label: "What Wins Elections" },
  { id: "upgrades", label: "Campaign Upgrades" },
  { id: "influence", label: "Political Influence" },
  { id: "favorability", label: "Building Favorability" },
  { id: "tips", label: "Quick Tips" },
];

export default function RunningForOfficePage() {
  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-10">
        {/* Breadcrumb */}
        <nav className="mb-6 flex items-center gap-1.5 text-sm text-muted">
          <Link href="/guides" className="hover:text-foreground transition-colors">
            Guides
          </Link>
          <span>/</span>
          <Link
            href="/guides/running-for-office"
            className="hover:text-foreground transition-colors"
          >
            Running for Office
          </Link>
          <span>/</span>
          <span className="text-foreground">United States</span>
        </nav>

        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Running for Office: United States</h1>
          <p className="mt-2 text-sm text-muted">
            A player&apos;s strategy guide, from declaring candidacy to winning your first seat
          </p>
        </div>

        <div className="space-y-10">
          {/* Table of Contents */}
          <div className="rounded-xl border border-card-border bg-card p-5">
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-muted">Contents</p>
            <ol className="grid gap-y-1 gap-x-4 text-sm sm:grid-cols-2">
              {TOC_ITEMS.map((item, i) => (
                <li key={item.id}>
                  <a href={`#${item.id}`} className="text-primary hover:underline">
                    {i + 1}. {item.label}
                  </a>
                </li>
              ))}
            </ol>
          </div>

          {/* ── 1. Eligibility ── */}
          <section className="space-y-4">
            <SectionHeader id="eligibility">1. Eligibility & Requirements</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Before you can file for any race, three conditions must be met: you need a character,
              you need to be a member of a political party, and the election must be accepting
              candidates.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-card-border bg-card p-4 space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted">Required</p>
                <ul className="space-y-1 text-sm text-muted">
                  <li>• Active character (created on profile)</li>
                  <li>• Party membership before filing</li>
                  <li>• Election must be in primary or active phase</li>
                  <li>• Race must be in your home state (local/state) or country (federal)</li>
                </ul>
              </div>
              <div className="rounded-xl border border-card-border bg-card p-4 space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted">
                  Restrictions
                </p>
                <ul className="space-y-1 text-sm text-muted">
                  <li>• One active race at a time</li>
                  <li>• Switching parties auto-withdraws your candidacy</li>
                  <li>• Entry closes once the primary phase ends</li>
                </ul>
              </div>
            </div>
            <Callout variant="info">
              <strong className="text-foreground">Consider joining a party first.</strong> Joining a
              party before filing gives you access to the party organization bonus in the vote
              formula; independents compete without it. Check the{" "}
              <Link href="/parties" className="text-primary hover:underline">
                parties page
              </Link>{" "}
              for your country&apos;s options before the next election opens.
            </Callout>
          </section>

          {/* ── 2. Choosing Your Race ── */}
          <section className="space-y-4">
            <SectionHeader id="races">2. Choosing Your Race</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Local and state races are your entry point. They are shorter, cheaper to run, and, if
              you win, they grant a permanent bonus to your action count and Political Influence
              generation that carries into future campaigns. Avoid jumping straight for a Senate
              seat; the incumbency and influence gap is brutal without an existing base.
            </p>
            <div className="overflow-x-auto rounded-xl border border-card-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card">
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Race</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Duration</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Scope</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">
                      Good first race?
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/60">
                  {[
                    ["State Legislature", "~8 days", "Home state", "Yes: low cost, fast result"],
                    [
                      "House of Representatives",
                      "~4 days",
                      "Home state district",
                      "Yes: short cycle",
                    ],
                    ["Governor", "~8 days", "Home state", "Strong second race"],
                    ["Senate", "~12 days", "Home state", "After building influence"],
                  ].map(([race, dur, scope, note]) => (
                    <tr key={race}>
                      <td className="px-4 py-2.5 text-foreground font-medium">{race}</td>
                      <td className="px-4 py-2.5 text-muted">{dur}</td>
                      <td className="px-4 py-2.5 text-muted">{scope}</td>
                      <td className="px-4 py-2.5 text-muted">{note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Callout variant="tip">
              <strong className="text-foreground">House races are the fastest ladder.</strong> A
              House term lasts only 2 game years (about 4 real days). Win one, hold it, and you
              build steady Political Influence that makes every subsequent race easier.
            </Callout>
          </section>

          {/* ── 3. The Primary Phase ── */}
          <section className="space-y-4">
            <SectionHeader id="primary">3. The Primary Phase</SectionHeader>
            <Callout variant="warn">
              <strong className="text-foreground">
                Campaign upgrades are a presidential race feature.
              </strong>{" "}
              The full campaign system described below (fundraising tiers, media spending, ground
              game, opposition research, and campaign actions) applies to{" "}
              <strong className="text-foreground">presidential elections only</strong>. In
              congressional and state races, the vote formula (alignment, PI, favorability, party
              org) still determines the outcome, but the upgrade infrastructure does not apply.
              Player endorsements also only grant campaign actions in presidential races.
            </Callout>
            <p className="text-sm text-muted leading-relaxed">
              The primary is your first hurdle: winning enough support within your own party to
              advance to the general. Use the{" "}
              <Link href="/elections" className="text-primary hover:underline">
                elections page
              </Link>{" "}
              to find open races and click{" "}
              <strong className="text-foreground">Declare Candidacy</strong>.
            </p>
            <SubHeader>What to prioritize during the primary</SubHeader>
            <ul className="space-y-2 text-sm text-muted">
              <li className="flex gap-2">
                <span className="text-primary font-bold shrink-0">1.</span>
                <span>
                  <strong className="text-foreground">
                    Spend campaign actions on fundraising upgrades first.
                  </strong>{" "}
                  All campaign upgrades cost 1.5× more during the general phase. Lock in your
                  fundraising level while costs are at the primary rate.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-primary font-bold shrink-0">2.</span>
                <span>
                  <strong className="text-foreground">
                    Use actions to build Political Influence.
                  </strong>{" "}
                  Each campaign action generates Political Influence, the stat that determines how
                  many voters you can actually reach. Low PI = low ceiling, no matter how
                  well-aligned your positions are.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-primary font-bold shrink-0">3.</span>
                <span>
                  <strong className="text-foreground">Watch your favorability.</strong> Favorability
                  directly scales your vote total. A candidate with 0% favorability gets zero votes
                  regardless of other stats. Use media spending to push it up incrementally each
                  turn.
                </span>
              </li>
            </ul>
            <Callout variant="info">
              <strong className="text-foreground">Endorsements matter.</strong> Your per-turn action
              count is <code className="font-mono text-xs">1 + floor(√endorsements × 3)</code>.
              Actively seek endorsements from NPPs and allied players; even a handful meaningfully
              increases your action rate.
            </Callout>
          </section>

          {/* ── 4. The General Phase ── */}
          <section className="space-y-4">
            <SectionHeader id="general">4. The General Phase</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              If you advance from the primary, the general campaign begins. All upgrade costs rise
              by 50%, so the general phase is about execution, not setup. Front-load your strategic
              decisions.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-card-border bg-card p-4 space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted">Do early</p>
                <ul className="space-y-1 text-sm text-muted">
                  <li>• Upgrade media spending to your target level</li>
                  <li>• Set up opposition research if running against a strong incumbent</li>
                  <li>• Reinvest campaign income into ground game if polling close</li>
                </ul>
              </div>
              <div className="rounded-xl border border-card-border bg-card p-4 space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted">
                  Final 4 turns
                </p>
                <ul className="space-y-1 text-sm text-muted">
                  <li>
                    • Media spending effectiveness{" "}
                    <strong className="text-foreground">doubles</strong>
                  </li>
                  <li>
                    • Opposition research effectiveness{" "}
                    <strong className="text-foreground">doubles</strong>
                  </li>
                  <li>• This is your burst window; make sure the upgrades are already in place</li>
                </ul>
              </div>
            </div>
            <Callout variant="warn">
              <strong className="text-foreground">
                The late-campaign multiplier does not activate upgrades you haven&apos;t bought.
              </strong>{" "}
              If you spend those final 4 turns purchasing media spending levels, you&apos;re paying
              1.5× cost for half the uptime. Buy early, benefit late.
            </Callout>
          </section>

          {/* ── 5. What Wins Elections ── */}
          <section className="space-y-4">
            <SectionHeader id="vote-formula">5. What Wins Elections</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Votes are calculated per demographic group, not as a simple aggregate. Each group
              allocates votes among candidates in proportion to their relative appeal. Your total
              vote share is the sum of what you receive from each group.
            </p>
            <FormulaBlock>{`Appeal = Position Alignment × Political Influence (Reach) × Favorability × Party Organization

Position Alignment = (50 - |economic gap| × 5 - |social gap| × 5)² / 100
Reach             = min(2.0, log(PI + 1) / log(101))  (~0.85 at PI 50, 1.0 at PI 100)
Favorability      = favorability% / 100
Party Org         = 1.0 + (partyOrg / 100) × 0.6   (range 1.0 to 1.6, no penalty for low org)`}</FormulaBlock>
            <p className="text-sm text-muted leading-relaxed">
              All four factors multiply together. A weakness in any one column drags down everything
              else:
            </p>
            <div className="overflow-x-auto rounded-xl border border-card-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card">
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Factor</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">
                      What drives it
                    </th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">
                      How to improve
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/60">
                  {[
                    [
                      "Position Alignment",
                      "How close your economic/social positions are to each voter group",
                      "Set positions in your character profile to match your target coalition",
                    ],
                    [
                      "Political Influence",
                      "How many voters you can actually reach",
                      "Campaign actions, holding office, and time",
                    ],
                    [
                      "Favorability",
                      "Raw approval; zero means zero votes",
                      "Media spending, campaign actions, endorsements",
                    ],
                    [
                      "Party Organization",
                      "Your party's strength in the state",
                      "Party actions, GOTV upgrades, winning prior races",
                    ],
                  ].map(([f, d, h]) => (
                    <tr key={f}>
                      <td className="px-4 py-2.5 text-foreground font-medium">{f}</td>
                      <td className="px-4 py-2.5 text-muted">{d}</td>
                      <td className="px-4 py-2.5 text-muted">{h}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <SubHeader>FPTP and third-party spoilers</SubHeader>
            <p className="text-sm text-muted leading-relaxed">
              Most races use First Past the Post. Under FPTP, the nearest major-party candidate
              loses approximately 4% of their vote share to you as a spoiler, but this is rarely
              enough to overcome the structural FPTP disadvantage. This spoiler effect disappears in
              states that use Ranked Choice Voting; in RCV races, third-party runs are fully
              competitive.
            </p>
            <Callout variant="tip">
              <strong className="text-foreground">
                State government approval affects your ceiling.
              </strong>{" "}
              Voter enthusiasm for state-level races is multiplied by the current state government
              approval rating. Running in a state where the incumbent party is unpopular is a
              structural advantage; the entire vote pool is more energized.
            </Callout>
          </section>

          {/* ── 6. Campaign Upgrades ── */}
          <section className="space-y-4">
            <SectionHeader id="upgrades">6. Campaign Upgrades</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Upgrades are purchased with campaign funds, a separate pool from your personal cash.
              Campaign funds accumulate from passive fundraising income each turn plus any party
              contributions. You cannot convert campaign funds back to personal cash.
            </p>
            <div className="overflow-x-auto rounded-xl border border-card-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card">
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Upgrade</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Max level</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Effect</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/60">
                  {[
                    [
                      "Fundraising",
                      "10",
                      "Passive income per turn",
                      "Buy in primary to avoid 1.5× general markup",
                    ],
                    [
                      "Media Spending",
                      "5 + maintenance",
                      "+0.5% favorability/turn per level",
                      "Doubles final 4 turns",
                    ],
                    [
                      "Ground Game",
                      "5 + maintenance",
                      "+3% turnout/level in your race's competitive areas (swing states for president, swing counties for senate / gov, swing precincts for house / state senate)",
                      "Most valuable in close races",
                    ],
                    [
                      "Opposition Research",
                      "5",
                      "−0.5% opponent favorability/turn per level",
                      "Doubles final 4 turns; pick one target",
                    ],
                  ].map(([u, l, e, n]) => (
                    <tr key={u}>
                      <td className="px-4 py-2.5 text-foreground font-medium">{u}</td>
                      <td className="px-4 py-2.5 text-muted">{l}</td>
                      <td className="px-4 py-2.5 text-muted">{e}</td>
                      <td className="px-4 py-2.5 text-muted">{n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <SubHeader>Passive fundraising income by level</SubHeader>
            <div className="overflow-x-auto rounded-xl border border-card-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card">
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">
                      Fundraising level
                    </th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">
                      Income per turn
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/60">
                  {[
                    ["0 (default)", "$20,000"],
                    ["1", "$35,000"],
                    ["5", "$200,000"],
                    ["10", "$5,000,000"],
                  ].map(([l, i]) => (
                    <tr key={l}>
                      <td className="px-4 py-2.5 text-muted">{l}</td>
                      <td className="px-4 py-2.5 text-foreground">{i}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── 7. Political Influence ── */}
          <section className="space-y-4">
            <SectionHeader id="influence">7. Political Influence</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Political Influence (PI) is your reach multiplier. At PI 0, you contact zero voters
              regardless of alignment or favorability. At PI 100, you reach every eligible voter in
              the state. PI decays over time and must be actively maintained.
            </p>
            <FormulaBlock>{`Decay per turn = current PI × 0.75%
  At PI 100:  −0.75 per turn
  At PI 50:   −0.375 per turn
  At PI 10:   −0.075 per turn
  → Proportional decay: higher PI decays faster in absolute terms,
    but the percentage loss rate is constant.

Gains:
  Campaign action:    +1% PI per action spent
  Holding office:     Bonus actions, easier maintenance
  Endorsements:       Indirectly via more actions per turn`}</FormulaBlock>
            <Callout variant="info">
              <strong className="text-foreground">Holding office is the best PI engine.</strong>{" "}
              Elected officials receive bonus campaign actions each turn. This compounds: more
              actions = more PI = more reach = easier re-election. A single House term meaningfully
              changes your trajectory in future races.
            </Callout>
          </section>

          {/* ── 8. Building Favorability ── */}
          <section className="space-y-4">
            <SectionHeader id="favorability">8. Building Favorability</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Favorability is the easiest stat to neglect and the most punishing to ignore; a
              candidate at 5% favorability gets roughly 5% of the votes they would otherwise
              deserve. It decays passively and needs constant investment.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-card-border bg-card p-4 space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted">
                  What raises favorability
                </p>
                <ul className="space-y-1 text-sm text-muted">
                  <li>• Spending campaign actions</li>
                  <li>• Media spending upgrades (+0.5%/level/turn)</li>
                  <li>• Endorsements from NPPs and players</li>
                  <li>• Archetype approval bonuses</li>
                </ul>
              </div>
              <div className="rounded-xl border border-card-border bg-card p-4 space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted">
                  What lowers it
                </p>
                <ul className="space-y-1 text-sm text-muted">
                  <li>• Natural decay each turn</li>
                  <li>• Opponent opposition research (−0.5%/level/turn)</li>
                  <li>• Poor policy alignment visibility</li>
                </ul>
              </div>
            </div>
          </section>

          {/* ── 9. Quick Tips ── */}
          <section className="space-y-4">
            <SectionHeader id="tips">9. Quick Tips</SectionHeader>
            <ul className="space-y-3 text-sm text-muted">
              {[
                [
                  "Join your party before elections open.",
                  "Entry closes at the end of the primary window. Switching parties after filing withdraws your candidacy.",
                ],
                [
                  "Buy fundraising upgrades in the primary, not the general.",
                  "The 1.5× general cost multiplier makes pre-primary investment significantly more efficient.",
                ],
                [
                  "Check what voting system your state uses.",
                  "FPTP punishes third-party runs; RCV does not. Know before you file as an independent.",
                ],
                [
                  "Pick your position carefully.",
                  "Positions affect alignment with every demographic group. Shifting them mid-campaign doesn't help; the calculation uses your current values, but voters remember.",
                ],
                [
                  "Use opposition research on one target, not spread across multiple.",
                  "The drain is per level per target. Concentrating it on the front-runner is almost always correct.",
                ],
                [
                  "Local office is not a stepping stone to ignore.",
                  "It is the best per-turn PI engine available early on. Treat it seriously.",
                ],
              ].map(([title, body]) => (
                <li
                  key={title as string}
                  className="flex gap-3 rounded-xl border border-card-border bg-card p-4"
                >
                  <span className="text-primary font-bold shrink-0 mt-0.5">→</span>
                  <span>
                    <strong className="text-foreground">{title}</strong> {body}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

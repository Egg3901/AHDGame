import type { Metadata } from "next";
import Link from "next/link";
import { publicPageMetadata } from "@/lib/siteMetadata";

export const metadata: Metadata = publicPageMetadata({
  title: "Running for Office (UK & Japan) | A House Divided",
  description:
    "How parliamentary elections work in A House Divided: unique mechanics for the UK and Japan including proportional representation, snap elections, cabinet bills, and government formation.",
  pathname: "/guides/running-for-office/intl",
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

const TOC_ITEMS = [
  { id: "parliament-vs-president", label: "Parliamentary vs Presidential" },
  { id: "shared-mechanics", label: "Shared Campaign Mechanics" },
  { id: "uk-offices", label: "UK: Offices & Races" },
  { id: "uk-electoral", label: "UK: Electoral System" },
  { id: "uk-government", label: "UK: Government Formation" },
  { id: "uk-tips", label: "UK: Strategy Tips" },
  { id: "jp-offices", label: "Japan: Offices & Races" },
  { id: "jp-electoral", label: "Japan: Electoral System" },
  { id: "jp-snap", label: "Japan: Snap Elections" },
  { id: "jp-cabinet", label: "Japan: Cabinet Bills" },
  { id: "jp-tips", label: "Japan: Strategy Tips" },
];

export default function RunningForOfficeIntlPage() {
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
          <span className="text-foreground">UK &amp; Japan</span>
        </nav>

        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Running for Office: UK &amp; Japan</h1>
          <p className="mt-2 text-sm text-muted">
            Parliamentary systems, proportional elections, snap elections, and the road to becoming
            Prime Minister
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

          {/* ── 1. Parliamentary vs Presidential ── */}
          <section className="space-y-4">
            <SectionHeader id="parliament-vs-president">
              1. Parliamentary vs Presidential
            </SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              The UK and Japan use{" "}
              <strong className="text-foreground">parliamentary systems</strong>. The Prime Minister
              is not directly elected; they are appointed from the legislature after winning a
              confidence vote. Winning a seat in parliament is the path to executive power, not a
              separate presidential race.
            </p>
            <div className="overflow-x-auto rounded-xl border border-card-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card">
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Feature</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">
                      US (Presidential)
                    </th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">
                      UK &amp; Japan (Parliamentary)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/60">
                  {[
                    [
                      "Executive",
                      "Separately elected President",
                      "PM appointed by confidence vote in legislature",
                    ],
                    [
                      "Winning strategy",
                      "Win your state's races + Electoral College",
                      "Win enough seats to form a majority government",
                    ],
                    [
                      "Bills",
                      "Pass both chambers + presidential signature",
                      "Pass the lower house (no executive veto)",
                    ],
                    [
                      "Government stability",
                      "Fixed 4-year terms",
                      "Can fall on a no-confidence vote at any time",
                    ],
                  ].map(([f, us, intl]) => (
                    <tr key={f}>
                      <td className="px-4 py-2.5 text-foreground font-medium">{f}</td>
                      <td className="px-4 py-2.5 text-muted">{us}</td>
                      <td className="px-4 py-2.5 text-muted">{intl}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Callout variant="info">
              This guide covers what is unique to UK and Japan. The underlying campaign mechanics
              (Political Influence, favorability, upgrades, and the vote formula) work the same as
              in the US. See the{" "}
              <Link href="/guides/running-for-office/us" className="text-primary hover:underline">
                US guide
              </Link>{" "}
              for a full explanation of those systems.
            </Callout>
          </section>

          {/* ── 2. Shared Campaign Mechanics ── */}
          <section className="space-y-4">
            <SectionHeader id="shared-mechanics">2. Shared Campaign Mechanics</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Everything in the US guide applies here too: the vote formula (alignment × reach ×
              favorability × party org), campaign upgrades, Political Influence decay, fundraising
              tiers, and the late-campaign doubling on media spending and opposition research.
            </p>
            <p className="text-sm text-muted leading-relaxed">
              One difference worth noting: in parliamentary elections, your{" "}
              <strong className="text-foreground">party&apos;s organization score</strong> matters
              more than in the US, because the government is formed by whichever party wins enough
              seats collectively, not by individual candidates. A weak party org drags down every
              candidate in every constituency simultaneously.
            </p>
          </section>

          {/* ═══════════════════════════════ UK ═══════════════════════════════ */}

          <div className="rounded-xl border border-card-border/60 bg-card/30 px-5 py-3">
            <p className="text-xs font-bold uppercase tracking-wider text-primary">
              United Kingdom
            </p>
          </div>

          {/* ── 3. UK Offices ── */}
          <section className="space-y-4">
            <SectionHeader id="uk-offices">3. UK: Offices &amp; Races</SectionHeader>
            <div className="overflow-x-auto rounded-xl border border-card-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card">
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Office</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Seats</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Scope</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Term</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/60">
                  {[
                    [
                      "Member of Parliament (MP)",
                      "650 total",
                      "Home region (England, Scotland, Wales, N. Ireland)",
                      "5 game years",
                    ],
                    [
                      "Regional Councillor",
                      "578 total across 12 regions",
                      "Home region",
                      "5 game years",
                    ],
                    ["Prime Minister", "1", "Appointed via confidence vote", "Until removed"],
                  ].map(([o, s, scope, t]) => (
                    <tr key={o}>
                      <td className="px-4 py-2.5 text-foreground font-medium">{o}</td>
                      <td className="px-4 py-2.5 text-muted">{s}</td>
                      <td className="px-4 py-2.5 text-muted">{scope}</td>
                      <td className="px-4 py-2.5 text-muted">{t}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Callout variant="warn">
              <strong className="text-foreground">
                Commons and Regional Council seats are mutually exclusive.
              </strong>{" "}
              If you win a seat in the House of Commons, your Regional Council seat is automatically
              vacated, and vice versa. Plan your career path before running; you cannot hold both.
            </Callout>
          </section>

          {/* ── 4. UK Electoral System ── */}
          <section className="space-y-4">
            <SectionHeader id="uk-electoral">4. UK: Electoral System</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              UK Commons elections use{" "}
              <strong className="text-foreground">multi-seat proportional representation</strong>{" "}
              (Hamilton method / largest remainder). Each region elects multiple MPs in proportion
              to the vote share each party receives.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-card-border bg-card p-4 space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted">
                  Seat allocation
                </p>
                <ul className="space-y-1 text-sm text-muted">
                  <li>• England: 543 MPs</li>
                  <li>• Scotland: 57 MPs</li>
                  <li>• Wales: 32 MPs</li>
                  <li>• Northern Ireland: 18 MPs</li>
                  <li>• Seats distributed proportionally by region vote share</li>
                </ul>
              </div>
              <div className="rounded-xl border border-card-border bg-card p-4 space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted">
                  Eligibility threshold
                </p>
                <ul className="space-y-1 text-sm text-muted">
                  <li>
                    • <strong className="text-foreground">20% minimum</strong> regional vote share
                    to receive any seats
                  </li>
                  <li>• Below 20%: zero seats regardless of absolute vote count</li>
                  <li>• Regional Council threshold is lower: 10%</li>
                </ul>
              </div>
            </div>
            <Callout variant="warn">
              <strong className="text-foreground">The 20% threshold is hard.</strong> A party
              polling at 18% gets nothing. This creates a significant spoiler dynamic: small parties
              that cannot clear 20% actively hurt the ideologically nearest larger party by bleeding
              votes. In a tight multi-party race, coordinate with allied parties or you both lose.
            </Callout>
            <SubHeader>Regional party dynamics</SubHeader>
            <p className="text-sm text-muted leading-relaxed">
              The regions are not identical. Scotland has the SNP as a major third force; Wales has
              Plaid Cymru; Northern Ireland has a completely different multi-party landscape (DUP,
              Sinn Féin, SDLP, UUP, Alliance). Running in Scotland or Wales means competing against
              nationalist parties with deep regional organization; factor this into your seat
              projections.
            </p>
          </section>

          {/* ── 5. UK Government Formation ── */}
          <section className="space-y-4">
            <SectionHeader id="uk-government">5. UK: Government Formation</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              After Commons elections resolve, seats are tallied across all four regions. The path
              to PM depends on how many seats your party controls.
            </p>
            <div className="overflow-x-auto rounded-xl border border-card-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card">
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Scenario</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">
                      Seats required
                    </th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Process</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/60">
                  {[
                    [
                      "Majority government",
                      "≥326 of 650",
                      "Automatic: largest party leader nominated; confidence vote triggered",
                    ],
                    [
                      "Minority government",
                      "≥130 (20%) but <326",
                      "Party must manually initiate; requires ≥130 votes to pass (not 326)",
                    ],
                    [
                      "Nomination fails",
                      "—",
                      "Next-largest party nominated; process repeats until a government forms",
                    ],
                  ].map(([s, r, p]) => (
                    <tr key={s}>
                      <td className="px-4 py-2.5 text-foreground font-medium">{s}</td>
                      <td className="px-4 py-2.5 text-muted">{r}</td>
                      <td className="px-4 py-2.5 text-muted">{p}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <SubHeader>No-confidence votes</SubHeader>
            <p className="text-sm text-muted leading-relaxed">
              A sitting PM can be removed by a no-confidence motion. Any Commons MP can trigger one;
              it runs for 24 hours; a simple majority of votes cast is needed to remove. On removal,
              government formation restarts from scratch. There is a 48-turn cooldown before another
              confidence vote can be called.
            </p>
            <Callout variant="tip">
              <strong className="text-foreground">Cabinet posts reset on every PM change.</strong>{" "}
              When a new PM is appointed, the entire cabinet is dismissed and all pending
              nominations are withdrawn. If you hold a cabinet role, plan for this; your position is
              not stable between governments.
            </Callout>
          </section>

          {/* ── 6. UK Tips ── */}
          <section className="space-y-4">
            <SectionHeader id="uk-tips">6. UK: Strategy Tips</SectionHeader>
            <ul className="space-y-3 text-sm text-muted">
              {[
                [
                  "Know the seat math before you run.",
                  "The Hamilton method means a 21% regional vote share gets you proportional seats; 19% gets you nothing. Run your party's polling before committing campaign spend.",
                ],
                [
                  "Scotland and Wales are not England.",
                  "SNP and Plaid Cymru have strong regional organization. A Labour or Conservative candidate in these regions faces a genuinely three-way race, not a two-party fight.",
                ],
                [
                  "Minority governments are viable.",
                  "The 100-seat threshold (about 15% of the Commons) to attempt government formation is a genuine path. A minority can govern, but it needs near-perfect whip discipline to survive confidence votes.",
                ],
                [
                  "Bills pass on Commons votes alone.",
                  "There is no executive veto and no Lords chamber to worry about. A Commons majority is all you need to pass legislation. Focus your organization there.",
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

          {/* ═══════════════════════════════ JAPAN ═══════════════════════════════ */}

          <div className="rounded-xl border border-card-border/60 bg-card/30 px-5 py-3">
            <p className="text-xs font-bold uppercase tracking-wider text-primary">Japan</p>
          </div>

          {/* ── 7. Japan Offices ── */}
          <section className="space-y-4">
            <SectionHeader id="jp-offices">7. Japan: Offices &amp; Races</SectionHeader>
            <div className="overflow-x-auto rounded-xl border border-card-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card">
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Office</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Seats</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">System</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Term</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/60">
                  {[
                    [
                      "Shugiin (House of Representatives)",
                      "465 across 8 regions",
                      "Proportional (Hamilton)",
                      "4 game years (can be cut short by snap election)",
                    ],
                    [
                      "Sangiin (House of Councillors)",
                      "248 across 8 regions, half elected per cycle",
                      "Proportional (Hamilton), staggered",
                      "6 game years (cannot be dissolved)",
                    ],
                    ["Governor", "1 per region (8 total)", "Standard election", "6 game years"],
                    ["Prime Minister", "1", "Confidence vote in Shugiin only", "Until removed"],
                  ].map(([o, s, sys, t]) => (
                    <tr key={o}>
                      <td className="px-4 py-2.5 text-foreground font-medium">{o}</td>
                      <td className="px-4 py-2.5 text-muted">{s}</td>
                      <td className="px-4 py-2.5 text-muted">{sys}</td>
                      <td className="px-4 py-2.5 text-muted">{t}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Callout variant="info">
              Only the <strong className="text-foreground">Shugiin</strong> votes on PM formation.
              Governors are elected separately and have no role in national government formation.
              The Sangiin provides legislative continuity since it cannot be dissolved, but it has
              no say in who becomes PM.
            </Callout>
          </section>

          {/* ── 8. Japan Electoral System ── */}
          <section className="space-y-4">
            <SectionHeader id="jp-electoral">8. Japan: Electoral System</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Both chambers use{" "}
              <strong className="text-foreground">multi-seat proportional representation</strong>{" "}
              (Hamilton method / largest remainder), the same system as UK Commons elections. Each
              region elects multiple members in proportion to each party&apos;s vote share, with a{" "}
              <strong className="text-foreground">20% minimum</strong> regional vote share required
              to receive any seats.
            </p>
            <SubHeader>Staggered Sangiin elections</SubHeader>
            <p className="text-sm text-muted leading-relaxed">
              The Sangiin&apos;s 248 seats are split into two classes. Only one class stands for
              election at a time, alternating every 3 game years:
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-card-border bg-card p-4 space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted">
                  Class 1 regions
                </p>
                <p className="text-sm text-muted">Hokkaido, Kanto, Kansai, Shikoku: 139 seats</p>
              </div>
              <div className="rounded-xl border border-card-border bg-card p-4 space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted">
                  Class 2 regions
                </p>
                <p className="text-sm text-muted">
                  Tohoku, Chubu, Chugoku, Kyushu &amp; Okinawa: 109 seats
                </p>
              </div>
            </div>
            <p className="text-sm text-muted leading-relaxed">
              The Sangiin can never be dissolved; it always provides legislative continuity. Even if
              a snap election wipes the Shugiin, the Sangiin continues operating with its existing
              membership.
            </p>
            <SubHeader>Regional party dynamics</SubHeader>
            <p className="text-sm text-muted leading-relaxed">
              Most regions operate as an LDP vs CDP two-party race. The exception is{" "}
              <strong className="text-foreground">Kansai</strong>, where Nippon Ishin (Ishin)
              replaces CDP as the primary opposition to the LDP. If you are running in Kansai on a
              CDP ticket, you are fighting as a third party; the 20% threshold means you risk
              winning zero seats if your vote share falls short.
            </p>
          </section>

          {/* ── 9. Snap Elections ── */}
          <section className="space-y-4">
            <SectionHeader id="jp-snap">9. Japan: Snap Elections</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Japan&apos;s most distinctive mechanic: the sitting PM can dissolve the Shugiin and
              call a snap election at any time.
            </p>
            <div className="overflow-x-auto rounded-xl border border-card-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card">
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Rule</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/60">
                  {[
                    ["Who can call it", "Sitting PM only"],
                    ["Uses per PM appointment", "2 (resets if a new PM is appointed)"],
                    ["Cooldown", "336 turns (~2 real weeks) between calls"],
                    [
                      "Duration",
                      "48 hours (24h primary + 24h general), much faster than the normal 192h cycle",
                    ],
                    [
                      "Scope",
                      "Cancels all active/upcoming regular Shugiin elections; spawns fresh snap elections in all 8 regions simultaneously",
                    ],
                    [
                      "Bills",
                      "All pending Japan bills that are not yet finalized are cancelled and marked failed",
                    ],
                    ["Government", "Government formation resets to pending"],
                  ].map(([r, d]) => (
                    <tr key={r}>
                      <td className="px-4 py-2.5 text-muted font-medium">{r}</td>
                      <td className="px-4 py-2.5 text-muted">{d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Callout variant="warn">
              <strong className="text-foreground">
                Snap elections kill all pending legislation.
              </strong>{" "}
              Every Japan bill not yet finalized is cancelled when a snap is called. If your party
              has important bills in progress, be aware that a PM snap election can wipe them all
              overnight. The PM has strong incentive to call snaps when losing legislative control;
              anticipate this if you are in the opposition.
            </Callout>
            <Callout variant="tip">
              <strong className="text-foreground">Snap campaigns are short and brutal.</strong> At
              48 hours, there is almost no time to build fundraising or run upgrades. Max PI and
              high favorability going into a snap election are your only real weapons. Keep both
              maintained between elections.
            </Callout>
          </section>

          {/* ── 10. Cabinet Bills ── */}
          <section className="space-y-4">
            <SectionHeader id="jp-cabinet">10. Japan: Cabinet Bills</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Japan has an exclusive legislative pathway unavailable in any other country:{" "}
              <strong className="text-foreground">cabinet bills</strong>. The PM or any cabinet
              member can propose legislation through the cabinet rather than introducing it directly
              into the Diet.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-card-border bg-card p-4 space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted">
                  How it works
                </p>
                <ul className="space-y-1 text-sm text-muted">
                  <li>• PM or any cabinet member proposes a bill</li>
                  <li>• 24-hour cabinet review phase opens</li>
                  <li>• All player-held cabinet positions vote</li>
                  <li>• Requires simple majority + at least 2 player votes</li>
                  <li>• NPP-held cabinet posts do not vote and do not count</li>
                  <li>• On passage, bill enters normal Shugiin → Sangiin flow</li>
                </ul>
              </div>
              <div className="rounded-xl border border-card-border bg-card p-4 space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted">
                  Why it matters
                </p>
                <ul className="space-y-1 text-sm text-muted">
                  <li>• Faster path for coalition-agreed legislation</li>
                  <li>• Bypasses open floor debate phase</li>
                  <li>• Only 1 cabinet bill can be in review at a time</li>
                  <li>• Gives the PM&apos;s inner circle real legislative leverage</li>
                </ul>
              </div>
            </div>
            <Callout variant="info">
              <strong className="text-foreground">Cabinet bills still go through the Diet.</strong>{" "}
              Passing the cabinet review just clears the proposal phase; the bill then enters the
              normal Shugiin vote, then Sangiin. It is faster, not a shortcut around the full
              legislature.
            </Callout>
          </section>

          {/* ── 11. Japan Tips ── */}
          <section className="space-y-4">
            <SectionHeader id="jp-tips">11. Japan: Strategy Tips</SectionHeader>
            <ul className="space-y-3 text-sm text-muted">
              {[
                [
                  "Win the Shugiin. Everything else is secondary.",
                  "The PM is chosen by Shugiin confidence vote only. The Sangiin cannot block PM formation. Build your majority in the lower house first.",
                ],
                [
                  "Kansai runs as an Ishin vs LDP race.",
                  "If you are CDP, you face a tough three-way split in Kansai. The 20% threshold means your vote share could fall below the cutoff; consider whether it is worth contesting the region or whether your resources are better spent elsewhere.",
                ],
                [
                  "As PM, treat snap elections as leverage, not panic buttons.",
                  "You have 2 snaps per appointment with a 336-turn cooldown. Call one when your party is ahead in polling, not when you are already losing. Snaps cancel all pending bills, which hurts you too.",
                ],
                [
                  "As opposition, keep your PI high between elections.",
                  "Snap elections give you almost no campaign window. The 48-hour duration means campaigns are decided by whoever already has Political Influence and favorability built up.",
                ],
                [
                  "Hold cabinet posts for legislative speed.",
                  "Cabinet bills are Japan-exclusive and faster than the standard floor process. If your party controls the cabinet, use it, especially for time-sensitive legislation.",
                ],
                [
                  "Shugiin can override Sangiin with a 2/3 supermajority.",
                  "If your party controls 310+ Shugiin seats, the Sangiin cannot block you. Build toward that threshold if you want true legislative dominance.",
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

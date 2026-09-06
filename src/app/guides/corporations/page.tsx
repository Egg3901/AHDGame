/**
 * The Corporation guide page: how to run a corporation, covering sector focus,
 * profit margins, commodities, sprawl, shares, bonds and political strategy.
 * Rendered by CorporationGuidePage.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { publicPageMetadata } from "@/lib/siteMetadata";

export const metadata: Metadata = publicPageMetadata({
  title: "Corporation Guide | A House Divided",
  description:
    "How to run a successful corporation in A House Divided: sector focus, profit margins, commodities, sprawl, shares, bonds, and political strategy.",
  pathname: "/guides/corporations",
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

function Tag({
  children,
  variant,
}: {
  children: React.ReactNode;
  variant: "positive" | "negative" | "neutral";
}) {
  const colors = {
    positive: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    negative: "bg-red-500/10 text-red-400 border-red-500/20",
    neutral: "bg-primary/10 text-primary border-primary/20",
  };
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-xs font-semibold ${colors[variant]}`}
    >
      {children}
    </span>
  );
}

const TOC_ITEMS = [
  { id: "founding", label: "Founding Your Corporation" },
  { id: "focus", label: "Choosing Sector Focus" },
  { id: "expansion", label: "Expanding Into States" },
  { id: "margins", label: "Profit Margin Modifiers" },
  { id: "commodities", label: "The Commodity Market" },
  { id: "strategies", label: "Operating Strategies" },
  { id: "sprawl", label: "Managing Sprawl" },
  { id: "ceo", label: "CEO: Salary, Marketing & Policy" },
  { id: "shares", label: "Shares & Dividends" },
  { id: "bonds", label: "Corporate Bonds" },
  { id: "politics", label: "The Political Angle" },
  { id: "shareprice", label: "How Share Price Works" },
  { id: "tips", label: "Quick Tips" },
];

export default function CorporationGuidePage() {
  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-10">
        {/* Breadcrumb */}
        <nav className="mb-6 flex items-center gap-1.5 text-sm text-muted">
          <Link href="/guides" className="hover:text-foreground transition-colors">
            Guides
          </Link>
          <span>/</span>
          <span className="text-foreground">Running a Corporation</span>
        </nav>

        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Running a Successful Corporation</h1>
          <p className="mt-2 text-sm text-muted">
            A player&apos;s guide from founding to market leadership
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

          {/* ── 1. Founding ── */}
          <section className="space-y-4">
            <SectionHeader id="founding">1. Founding Your Corporation</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Head to{" "}
              <Link href="/corporations" className="text-primary hover:underline font-mono text-xs">
                /corporations
              </Link>{" "}
              and click <strong className="text-foreground">Found Corporation</strong>. You pay{" "}
              <strong className="text-foreground">$1,000,000</strong> from your character&apos;s
              cash on hand. The corporation starts with that same amount as liquid capital.
              It&apos;s a transfer, not a loss.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-card-border bg-card p-4 space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted">
                  What you start with
                </p>
                <ul className="space-y-1 text-sm text-muted">
                  <li>• $1,000,000 liquid capital (in the corp)</li>
                  <li>• 10,000,000 CEO shares @ $0.10</li>
                  <li>• Marketing Strength (MS): 10</li>
                  <li>• No sectors yet</li>
                </ul>
              </div>
              <div className="rounded-xl border border-card-border bg-card p-4 space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted">Key rules</p>
                <ul className="space-y-1 text-sm text-muted">
                  <li>• One corporation per character</li>
                  <li>• HQ set to your current home state</li>
                  <li>• CEOs can relocate the company independently of their own character</li>
                </ul>
              </div>
            </div>
            <Callout variant="warn">
              <strong className="text-foreground">Residence lock:</strong> If you plan to run for
              office in another state, be aware that relocating to any state auto-resigns you as
              CEO. Plan your political career around your corporation&apos;s HQ state, or hand off
              the CEO role before relocating.
            </Callout>
          </section>

          {/* ── 2. Sector Focus ── */}
          <section className="space-y-4">
            <SectionHeader id="focus">2. Choosing Sector Focus</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Your corporation has a <strong className="text-foreground">primary type</strong>{" "}
              (required) and an optional <strong className="text-foreground">secondary type</strong>
              , set from the CEO Office. This is the single most impactful structural decision you
              make. A <Tag variant="negative">−15%</Tag> margin penalty on every off-type sector
              will drain any corporation over time.
            </p>
            <div className="overflow-x-auto rounded-xl border border-card-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card">
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Sector owned</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Modifier</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Why</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/60">
                  <tr>
                    <td className="px-4 py-2.5 text-foreground">Matches primary type</td>
                    <td className="px-4 py-2.5">
                      <Tag variant="positive">+5%</Tag>
                    </td>
                    <td className="px-4 py-2.5 text-muted">Core competency bonus</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 text-foreground">Matches secondary type</td>
                    <td className="px-4 py-2.5">
                      <Tag variant="positive">+2.5%</Tag>
                    </td>
                    <td className="px-4 py-2.5 text-muted">Half-strength diversification bonus</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 text-foreground">Everything else</td>
                    <td className="px-4 py-2.5">
                      <Tag variant="negative">−15%</Tag>
                    </td>
                    <td className="px-4 py-2.5 text-muted">Off-focus penalty</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-sm text-muted leading-relaxed">
              There are <strong className="text-foreground">17 sector types</strong>: Financial,
              Media, Manufacturing, Healthcare, Retail, Automobiles, Technology, Energy,
              Agriculture, Real Estate, Defense, Telecommunications, Entertainment, Logistics,
              Extraction, Chemical Industries, and Construction.
            </p>
            <SubHeader>Secondary Type Trade-off</SubHeader>
            <p className="text-sm text-muted leading-relaxed">
              A secondary type gives you +2.5% on a second sector class instead of −15%. The cost:
              it <strong className="text-foreground">doubles the sprawl penalty</strong> once you
              exceed the 15-sector threshold (see Sprawl section). Worth it if you genuinely want
              two sector classes and invest in Logistics & Operations Strength.
            </p>
            <Callout variant="warn">
              <strong className="text-foreground">Type switching costs you:</strong> Changing your
              primary or secondary type triggers a{" "}
              <strong className="text-foreground">
                −10% margin penalty on all sectors for 24 hours
              </strong>
              , followed by a 48-hour cooldown. Total lockout: 72 hours. Don&apos;t switch on a
              whim.
            </Callout>
          </section>

          {/* ── 3. Expansion ── */}
          <section className="space-y-4">
            <SectionHeader id="expansion">3. Expanding Into States</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Each sector you own is a specific type in a specific state. Expand from the CEO Office
              Overview tab.
            </p>
            <FormulaBlock>{`State market size per sector = State GDP (millions) × 100 ÷ 17
  → bigger states = bigger potential revenue pools`}</FormulaBlock>
            <div className="overflow-x-auto rounded-xl border border-card-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card">
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Parameter</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/60">
                  {[
                    ["Expansion cost", "$100,000 per new state sector"],
                    ["Starting revenue", "$1,000,000 per sector"],
                    ["Starting workers", "500"],
                    ["Default profit margin", "35% (before modifiers)"],
                  ].map(([k, v]) => (
                    <tr key={k}>
                      <td className="px-4 py-2.5 text-muted">{k}</td>
                      <td className="px-4 py-2.5 text-foreground">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <SubHeader>Market Capture (Splits)</SubHeader>
            <p className="text-sm text-muted leading-relaxed">
              Once you own a sector in a state, use{" "}
              <strong className="text-foreground">splits</strong> to capture unowned market share.
              Each split costs cash and Marketing Strength (MS):
            </p>
            <FormulaBlock>{`Cash cost  = 5% of the unowned sector's current revenue
MS cost    = 2^splitEscalation  →  1 → 2 → 4 → 8 → 16 MS per split
Capture    ≈ 6% of unowned × (1 + marketingStrength ÷ 100)

Escalation drops by 1 each turn. Costs halve if you wait`}</FormulaBlock>
            <Callout variant="tip">
              <strong className="text-foreground">Split pacing:</strong> Don&apos;t spam splits.
              Each one doubles the next MS cost. At 8 MS/split, waiting 2 turns brings it back to 2.
              Patience saves MS and lets you capture more total share for the same marketing budget.
            </Callout>

            <SubHeader>Unowned Sectors Grow Back</SubHeader>
            <p className="text-sm text-muted leading-relaxed">
              The unowned portion of a sector{" "}
              <strong className="text-foreground">grows every turn</strong> at the average growth
              rate of player-owned sectors in that state and type. Don&apos;t sit on low market
              share in a sector you care about. The pool regenerates.
            </p>
          </section>

          {/* ── 4. Margins ── */}
          <section className="space-y-4">
            <SectionHeader id="margins">4. Profit Margin Modifiers</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Sectors start at <strong className="text-foreground">35% margin</strong> and receive
              additive modifiers from state conditions, national macro, and your corporation&apos;s
              structure. Margins can go negative (a sector that costs you money every turn). All
              active modifiers are visible on each sector&apos;s detail card in the CEO Office.
            </p>
            <div className="overflow-x-auto rounded-xl border border-card-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card">
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Modifier</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Max effect</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Sectors</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/60 text-muted">
                  <tr>
                    <td className="px-4 py-2.5 text-foreground font-medium">Sector type match</td>
                    <td className="px-4 py-2.5">
                      <Tag variant="positive">+5%</Tag> / <Tag variant="negative">−15%</Tag>
                    </td>
                    <td className="px-4 py-2.5">All</td>
                    <td className="px-4 py-2.5">Primary +5%, secondary +2.5%, other −15%</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 text-foreground font-medium">Home location</td>
                    <td className="px-4 py-2.5">
                      <Tag variant="positive">+10%</Tag> / <Tag variant="positive">+5%</Tag>
                    </td>
                    <td className="px-4 py-2.5">All</td>
                    <td className="px-4 py-2.5">HQ state +10%, same country +5%, abroad +0%</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 text-foreground font-medium">Subsidies</td>
                    <td className="px-4 py-2.5">
                      <Tag variant="positive">+15% each</Tag>
                    </td>
                    <td className="px-4 py-2.5">Qualifying types</td>
                    <td className="px-4 py-2.5">Federal and state stack independently</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 text-foreground font-medium">Unemployment</td>
                    <td className="px-4 py-2.5">
                      <Tag variant="neutral">±5%</Tag>
                    </td>
                    <td className="px-4 py-2.5">All</td>
                    <td className="px-4 py-2.5">Pivot at 3%. High unemployment → better margins</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 text-foreground font-medium">Inflation</td>
                    <td className="px-4 py-2.5">
                      <Tag variant="positive">+2%</Tag> / <Tag variant="negative">−8%</Tag>
                    </td>
                    <td className="px-4 py-2.5">All (country-wide)</td>
                    <td className="px-4 py-2.5">Target 2%; −8% at 10%+ inflation</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 text-foreground font-medium">Deficit spending</td>
                    <td className="px-4 py-2.5">
                      <Tag variant="positive">+5% max</Tag>
                    </td>
                    <td className="px-4 py-2.5">All (country-wide)</td>
                    <td className="px-4 py-2.5">+0.5% per 1% of GDP deficit; stimulative</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 text-foreground font-medium">Debt-to-GDP</td>
                    <td className="px-4 py-2.5">
                      <Tag variant="negative">−15% cap</Tag>
                    </td>
                    <td className="px-4 py-2.5">All (country-wide)</td>
                    <td className="px-4 py-2.5">Kicks in above 50% D/GDP</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 text-foreground font-medium">Power grid</td>
                    <td className="px-4 py-2.5">
                      <Tag variant="negative">−4%</Tag>
                    </td>
                    <td className="px-4 py-2.5">All</td>
                    <td className="px-4 py-2.5">No effect above 95% uptime; scales 85-95%</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 text-foreground font-medium">Corruption</td>
                    <td className="px-4 py-2.5">
                      <Tag variant="negative">−3%</Tag>
                    </td>
                    <td className="px-4 py-2.5">All</td>
                    <td className="px-4 py-2.5">Linear to −3% at index 100</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 text-foreground font-medium">Workforce skill</td>
                    <td className="px-4 py-2.5">
                      <Tag variant="neutral">±4%</Tag>
                    </td>
                    <td className="px-4 py-2.5">Tech, Chemicals, Healthcare, Mfg, Defense</td>
                    <td className="px-4 py-2.5">Pivot at skill index 50</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 text-foreground font-medium">Crime rate</td>
                    <td className="px-4 py-2.5">
                      <Tag variant="negative">−5%</Tag>
                    </td>
                    <td className="px-4 py-2.5">Retail, Real Estate, Entertainment</td>
                    <td className="px-4 py-2.5">1,500-3,500 per 100k</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 text-foreground font-medium">Broadband</td>
                    <td className="px-4 py-2.5">
                      <Tag variant="negative">−4%</Tag>
                    </td>
                    <td className="px-4 py-2.5">Tech, Telecom, Media, Financial</td>
                    <td className="px-4 py-2.5">Gate 70%, full penalty below 40%</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 text-foreground font-medium">Road condition</td>
                    <td className="px-4 py-2.5">
                      <Tag variant="neutral">±3%</Tag>
                    </td>
                    <td className="px-4 py-2.5">
                      Mfg, Retail, Agri, Autos, Const, Logistics, Extraction
                    </td>
                    <td className="px-4 py-2.5">Pivot at condition index 60</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 text-foreground font-medium">Carbon emissions</td>
                    <td className="px-4 py-2.5">
                      <Tag variant="negative">−3%</Tag>
                    </td>
                    <td className="px-4 py-2.5">Energy, Chemicals, Mfg, Autos, Extraction</td>
                    <td className="px-4 py-2.5">3-25 MT per capita</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 text-foreground font-medium">Cost of living</td>
                    <td className="px-4 py-2.5">
                      <Tag variant="neutral">±3%</Tag>
                    </td>
                    <td className="px-4 py-2.5">
                      Chemicals, Mfg, Retail, Agri, Const, Logistics, Extraction
                    </td>
                    <td className="px-4 py-2.5">Pivot at index 100</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 text-foreground font-medium">Commodity market</td>
                    <td className="px-4 py-2.5 text-muted">Uncapped</td>
                    <td className="px-4 py-2.5">Sector-dependent</td>
                    <td className="px-4 py-2.5">See Commodity Market section</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 text-foreground font-medium">Logistical sprawl</td>
                    <td className="px-4 py-2.5 text-muted">Uncapped</td>
                    <td className="px-4 py-2.5">All (corp-wide)</td>
                    <td className="px-4 py-2.5">See Sprawl section</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <Callout variant="info">
              <strong className="text-foreground">Three national macro modifiers</strong>{" "}
              (inflation, debt/GDP, deficit/GDP) apply to your entire corporation based on the
              country your HQ is in. These can swing margins ±13% on top of everything else. Watch
              national fiscal health as much as state conditions.
            </Callout>

            <SubHeader>Home Location Bonus</SubHeader>
            <p className="text-sm text-muted leading-relaxed">
              Sectors in your <strong className="text-foreground">HQ state</strong> get +10%;
              sectors in the same country (different state) get +5%. This makes early expansion in
              your home state very strong. You effectively start with 45% base margin before any
              other modifier.
            </p>

            <SubHeader>Subsidies Are Huge</SubHeader>
            <p className="text-sm text-muted leading-relaxed">
              Each active subsidy adds{" "}
              <strong className="text-foreground">+15 percentage points</strong> to qualifying
              sectors. Federal and state subsidies stack. A sector with both starts at 65% margin.
              Use your political influence to champion subsidy bills for your sector type.
            </p>
          </section>

          {/* ── 5. Commodities ── */}
          <section className="space-y-4">
            <SectionHeader id="commodities">5. The Commodity Market</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Your sectors buy and sell commodities each turn. Commodity prices and supply/demand
              ratios modify your margins, sometimes dramatically. Check{" "}
              <Link
                href="/commodity/steel"
                className="text-primary hover:underline font-mono text-xs"
              >
                /commodity/[type]
              </Link>{" "}
              for live price charts and supply/demand data. There are 29 commodity types covering
              everything from steel and oil to software, healthcare services, and real estate.
            </p>
            <p className="text-sm text-muted leading-relaxed">
              In short: prices rise when demand outstrips supply and fall when supply outstrips
              demand, but the curve is logarithmic, so the first bit of shortage moves price a lot
              and each further bit moves it less. No ratio sends price to infinity.
            </p>
            <FormulaBlock>{`rawRatio = demand / supply
effectiveRatio = rawRatio through 3x, then softened in the tail

Market price (effectiveRatio ≥ 1) = basePrice × (1 + 0.7 × ln(effectiveRatio))
Market price (effectiveRatio < 1) = basePrice / (1 + 0.7 × |ln(effectiveRatio)|)

Margin modifier = 40 × Σ(rate × ln(effectiveRatio))
  → raw D/S is visible, but prices and margins soften above 3x`}</FormulaBlock>
            <div className="overflow-x-auto rounded-xl border border-card-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card">
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">
                      Raw D/S ratio
                    </th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Seller bonus</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">
                      Buyer penalty
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/60 text-muted">
                  {[
                    ["0.5× (oversupply)", "−27.7%", "+27.7%"],
                    ["1× (balanced)", "0%", "0%"],
                    ["1.5×", "+16.2%", "−16.2%"],
                    ["2×", "+27.7%", "−27.7%"],
                    ["3×", "+43.9%", "−43.9%"],
                  ].map(([ratio, sell, buy]) => (
                    <tr key={ratio}>
                      <td className="px-4 py-2.5 text-foreground">{ratio}</td>
                      <td className="px-4 py-2.5">
                        <Tag
                          variant={
                            sell?.startsWith("+")
                              ? "positive"
                              : sell === "0%"
                                ? "neutral"
                                : "negative"
                          }
                        >
                          {sell}
                        </Tag>
                      </td>
                      <td className="px-4 py-2.5">
                        <Tag
                          variant={
                            buy?.startsWith("+")
                              ? "positive"
                              : buy === "0%"
                                ? "neutral"
                                : "negative"
                          }
                        >
                          {buy}
                        </Tag>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Callout variant="tip">
              <strong className="text-foreground">Be a seller in shortage markets.</strong> If your
              output commodity is in shortage (demand &gt; supply), you get a large positive margin
              modifier. Watch commodity pages to identify which sector types are underserved, then
              expand into them.
            </Callout>
            <p className="text-sm text-muted leading-relaxed">
              <strong className="text-foreground">Retail is special:</strong> Retail sectors take
              only <strong className="text-foreground">25%</strong> of the downside from negative
              commodity input modifiers. They can substitute or absorb shortages better than other
              sectors. Their demand also scales with national GDP growth, making them more sensitive
              to the macro economy.
            </p>
          </section>

          {/* ── 6. Strategies ── */}
          <section className="space-y-4">
            <SectionHeader id="strategies">6. Operating Strategies</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Each sector has an <strong className="text-foreground">operating strategy</strong>{" "}
              that changes which commodities it buys and sells (and at what rates), plus a separate{" "}
              <strong className="text-foreground">production policy level</strong> that adjusts the
              volume/margin trade-off. Both are configurable from the CEO Office.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-card-border bg-card p-4 space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-muted">
                  Operating Strategy
                </p>
                <p className="text-sm text-muted">
                  Each sector type has 3-4 named strategies that change commodity supply/demand
                  rates.
                </p>
                <ul className="space-y-1 text-sm text-muted">
                  <li>
                    • Switching costs{" "}
                    <strong className="text-foreground">25% of daily sector revenue</strong>
                  </li>
                  <li>
                    • 12-turn transition with <Tag variant="negative">−5%</Tag> margin penalty
                  </li>
                  <li>• 24-turn cooldown after transition completes</li>
                </ul>
              </div>
              <div className="rounded-xl border border-card-border bg-card p-4 space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-muted">
                  Production Policy
                </p>
                <p className="text-sm text-muted">
                  A continuous <strong className="text-foreground">−25 to +25 scale</strong>. You
                  set a target; the active level moves toward it at 1 unit per turn.
                </p>
                <ul className="space-y-1 text-sm text-muted">
                  <li>
                    • <strong className="text-foreground">Positive (+25):</strong> More volume,
                    lower margins
                  </li>
                  <li>
                    • <strong className="text-foreground">Zero:</strong> Balanced default
                  </li>
                  <li>
                    • <strong className="text-foreground">Negative (−25):</strong> Less volume,
                    higher margins
                  </li>
                </ul>
              </div>
            </div>
            <Callout variant="info">
              Before switching strategy, the confirmation panel shows a per-commodity comparison
              (old vs new rates) and current market status. Use it. Don&apos;t switch into a
              strategy that demands an already-scarce commodity.
            </Callout>
          </section>

          {/* ── 7. Sprawl ── */}
          <section className="space-y-4">
            <SectionHeader id="sprawl">7. Managing Sprawl</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Every sector beyond 15 applies a{" "}
              <strong className="text-foreground">logistical sprawl penalty</strong> to all your
              margins. It compounds quickly at scale.
            </p>
            <FormulaBlock>{`Sprawl penalty = −0.5% per 2 sectors over 15
  doubled to −1.0% per pair if a secondary type is set

Logistics & Operations Strength (LS) raises the threshold and halves the slope:
  LS = 0   → threshold 15, −0.5% per pair
  LS = 200 → threshold 30, −0.25% per pair`}</FormulaBlock>
            <div className="overflow-x-auto rounded-xl border border-card-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card">
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">
                      Total sectors
                    </th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">
                      Over threshold
                    </th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">
                      Penalty (LS 0, no secondary)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/60 text-muted">
                  {[
                    ["≤ 15", "0", "0%"],
                    ["17", "2", "−0.5%"],
                    ["21", "6", "−1.5%"],
                    ["25", "10", "−2.5%"],
                    ["35", "20", "−5.0%"],
                  ].map(([total, over, penalty]) => (
                    <tr key={total}>
                      <td className="px-4 py-2.5 text-foreground">{total}</td>
                      <td className="px-4 py-2.5">{over}</td>
                      <td className="px-4 py-2.5">
                        <Tag variant={penalty === "0%" ? "neutral" : "negative"}>{penalty}</Tag>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Callout variant="tip">
              Invest in <strong className="text-foreground">Logistics & Operations Strength</strong>{" "}
              before aggressively expanding past 15 sectors. At LS 200, your penalty-free threshold
              doubles to 30 and the slope halves. Find the spending option in CEO Office → Settings.
            </Callout>
          </section>

          {/* ── 8. CEO: Salary, Marketing, Policy ── */}
          <section className="space-y-4">
            <SectionHeader id="ceo">8. CEO Controls: Salary, Marketing & Policy</SectionHeader>

            <SubHeader>CEO Salary</SubHeader>
            <p className="text-sm text-muted leading-relaxed">
              You can configure a daily salary for yourself in CEO Office → Settings. The amount is
              deducted from the corporation&apos;s liquid capital each turn (spread evenly over 24
              turns per day) and deposited as personal cash. There&apos;s no enforced minimum or
              maximum, but high salaries drain capital and depress the share price over time.
            </p>

            <SubHeader>Marketing Budget & Marketing Strength</SubHeader>
            <p className="text-sm text-muted leading-relaxed">
              Marketing Strength (MS) determines how much unowned market share you capture per
              split. It grows each turn based on your daily marketing budget (set in CEO Office →
              Settings).
            </p>
            <FormulaBlock>{`Base growth    = 1 MS/turn (if any spend at all)
Scaled growth  = 0.65 × ln(1 + dailyBudget / 100,000)
  → strong returns up to ~$100k/day; heavy diminishing returns above that
  → both components slow further once MS exceeds 100`}</FormulaBlock>
            <p className="text-sm text-muted leading-relaxed">
              Starting MS is 10. Effective range is 0-200+, but MS above ~100 gives diminishing
              capture gains. The marketing budget is deducted from liquid capital each turn like any
              other cost.
            </p>
          </section>

          {/* ── 9. Shares ── */}
          <section className="space-y-4">
            <SectionHeader id="shares">9. Shares & Dividends</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              You can trade shares in any corporation from its page, accessible via the stock
              exchange (
              <Link
                href="/stockmarket/us"
                className="text-primary hover:underline font-mono text-xs"
              >
                /stockmarket/us
              </Link>{" "}
              or{" "}
              <Link
                href="/stockmarket/uk"
                className="text-primary hover:underline font-mono text-xs"
              >
                /stockmarket/uk
              </Link>
              ).
            </p>

            <SubHeader>As CEO: Raising Capital</SubHeader>
            <ul className="space-y-1.5 text-sm text-muted">
              <li>
                <strong className="text-foreground">Public issuance</strong>. Sell up to 50% of
                outstanding shares into the public float. Dilutes your ownership but raises liquid
                capital.
              </li>
              <li>
                <strong className="text-foreground">Self-issuance</strong>. Issue shares to yourself
                at a 15% premium; proceeds go directly to corporate capital.
              </li>
              <li>
                <strong className="text-foreground">Stock splits / reverse splits</strong>. Adjust
                total share count. Market cap and ownership percentages stay the same. All open
                limit orders must be cancelled first.
              </li>
            </ul>

            <SubHeader>Dividends</SubHeader>
            <p className="text-sm text-muted leading-relaxed">
              Set your dividend rate (0-100%) in CEO Office → Settings. Dividends are paid pro-rata
              to all shareholders each turn from post-tax income. 24-hour cooldown on rate changes.
            </p>
            <Callout variant="info">
              <strong className="text-foreground">High dividends vs. reinvestment:</strong>{" "}
              Dividends move money from the corporation to shareholders. Early-stage corps should
              reinvest. Retain capital for expansion and logistics spend. Mature corps with excess
              capital can reward shareholders.
            </Callout>

            <SubHeader>CEO Elections</SubHeader>
            <p className="text-sm text-muted leading-relaxed">
              When the CEO position is contested, votes are{" "}
              <strong className="text-foreground">weighted by share count</strong>, not
              one-per-holder. A voter with 500,000 shares contributes 500,000 votes. Maintain
              majority ownership (or build a loyal shareholder bloc) to control any leadership vote.
            </p>

            <SubHeader>Shareholder Address</SubHeader>
            <p className="text-sm text-muted leading-relaxed">
              CEOs can broadcast a message to all current shareholders via CEO Office → Admin
              subtab. Useful for announcing strategy changes or rallying investors. Limited to once
              per 12 hours.
            </p>
          </section>

          {/* ── 10. Bonds ── */}
          <section className="space-y-4">
            <SectionHeader id="bonds">10. Corporate Bonds</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Issue bonds to raise capital without diluting equity. Other players and corporations
              can buy them as investments.
            </p>
            <div className="overflow-x-auto rounded-xl border border-card-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card">
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Parameter</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/60 text-muted">
                  {[
                    ["Minimum issuance", "$100,000"],
                    ["Maximum total debt", "2× equity"],
                    ["Maturity options", "1 yr (48 turns), 2 yr (96), 5 yr (240)"],
                    ["Coupon rate", "Auto-set: prime rate + credit spread"],
                    ["Face value per unit", "$1,000"],
                  ].map(([k, v]) => (
                    <tr key={k}>
                      <td className="px-4 py-2.5">{k}</td>
                      <td className="px-4 py-2.5 text-foreground">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <SubHeader>Credit Rating</SubHeader>
            <p className="text-sm text-muted leading-relaxed">
              Your credit rating (0-100) is computed from four factors:{" "}
              <strong className="text-foreground">debt-to-equity ratio</strong> (is the company
              overleveraged), <strong className="text-foreground">interest coverage ratio</strong>{" "}
              (can it pay interest from earnings),{" "}
              <strong className="text-foreground">profitability</strong> (is it actually making
              money), and <strong className="text-foreground">liquidity</strong> (does it have cash
              on hand). A higher rating means a lower credit spread and cheaper borrowing. Keep your
              corp profitable and debt-light to maintain it.
            </p>
            <Callout variant="warn">
              <strong className="text-foreground">Debt ceiling:</strong> Total debt cannot exceed 2×
              equity. If equity shrinks through losses or heavy dividends, you may lose issuance
              capacity or face pressure to retire outstanding bonds.
            </Callout>
          </section>

          {/* ── 11. Politics ── */}
          <section className="space-y-4">
            <SectionHeader id="politics">11. The Political Angle</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Your corporation lives in states with legislators, governors, and national policies
              that directly affect your margins. The political and economic systems are deeply
              intertwined.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                  Legislation that helps
                </p>
                <ul className="space-y-1 text-sm text-muted">
                  <li>
                    • <strong className="text-foreground">Sector subsidies</strong>. +7.5% margin
                    each
                  </li>
                  <li>
                    • <strong className="text-foreground">Infrastructure bills</strong>. Improve
                    grid, roads, broadband
                  </li>
                  <li>
                    • <strong className="text-foreground">Low corporate tax rates</strong>. Straight
                    to the bottom line. Each country now sets two rates: a <strong>domestic</strong>{" "}
                    rate (for corps HQ&apos;d in that country) and a <strong>foreign</strong> rate
                    (for everyone else). When expanding abroad you pay the host country&apos;s
                    foreign rate on those sectors&apos; profits.
                  </li>
                  <li>
                    • <strong className="text-foreground">Crime reduction</strong>. Helps Retail,
                    Real Estate, Entertainment
                  </li>
                  <li>
                    • <strong className="text-foreground">Deficit spending</strong>. +0.5% per 1% of
                    GDP deficit
                  </li>
                </ul>
              </div>
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-red-400">
                  Legislation that hurts
                </p>
                <ul className="space-y-1 text-sm text-muted">
                  <li>
                    • <strong className="text-foreground">High corporate tax rates</strong>. The
                    domestic rate on your home country hurts every sector; foreign rates on
                    countries you&apos;ve expanded into hurt only those sectors.
                  </li>
                  <li>
                    • <strong className="text-foreground">Tariffs</strong>. Hurts cross-border
                    operations
                  </li>
                  <li>
                    • <strong className="text-foreground">Carbon emission caps</strong>. Energy,
                    Chemicals, Mfg, Autos, Extraction
                  </li>
                  <li>
                    • <strong className="text-foreground">High sovereign debt</strong>. −15% cap on
                    all margins
                  </li>
                </ul>
              </div>
            </div>
          </section>

          {/* ── 12. Share Price ── */}
          <section className="space-y-4">
            <SectionHeader id="shareprice">12. How Share Price Works</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Share price is recalculated every turn as a weighted blend of three components:
            </p>
            <p className="text-sm text-muted leading-relaxed">
              In short: price blends what the corporation owns (book value) with what it earns,
              valued at a <strong className="text-foreground">P/E multiple</strong> of 6 (a
              price-to-earnings multiple: investors pay $6 of price for every $1 of annual income),
              plus recent price momentum, with owned assets weighted most heavily. Sector profits
              are converted into a lump-sum value using a{" "}
              <strong className="text-foreground">25% discount rate</strong> (the annual return
              investors demand before a future profit stream is worth paying for today).
            </p>
            <FormulaBlock>{`Share price = 0.15 × previousPrice + 0.60 × bookValue + 0.25 × incomeValue

bookValue   = (liquidCapital + income + sectorNPV) ÷ totalShares
incomeValue = (annualIncome ÷ totalShares) × 6    ← P/E multiple of 6
incomeValue is capped at 4 × bookValue

sectorNPV = (yearly sector profit) ÷ 0.25         ← 25% discount rate`}</FormulaBlock>
            <div className="overflow-x-auto rounded-xl border border-card-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card">
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Component</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Weight</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">
                      What it rewards
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/60 text-muted">
                  <tr>
                    <td className="px-4 py-2.5">Momentum (previous price)</td>
                    <td className="px-4 py-2.5 text-foreground">15%</td>
                    <td className="px-4 py-2.5">Stability. Prevents violent swings</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5">Book value per share</td>
                    <td className="px-4 py-2.5 text-foreground">60%</td>
                    <td className="px-4 py-2.5">
                      Liquid capital + sector NPV. The actual asset base
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5">Income valuation</td>
                    <td className="px-4 py-2.5 text-foreground">25%</td>
                    <td className="px-4 py-2.5">Profitability at a P/E of 6</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-sm text-muted leading-relaxed">
              <strong className="text-foreground">Book value dominates</strong> at 60%. Growing
              sector revenue, protecting margins, and accumulating liquid capital all increase book
              value, which drives share price more reliably than chasing short-term income.
            </p>
          </section>

          {/* ── 13. Quick Tips ── */}
          <section className="space-y-4">
            <SectionHeader id="tips">13. Quick Tips</SectionHeader>
            <div className="rounded-xl border border-card-border bg-card p-5">
              <ul className="space-y-3 text-sm text-muted">
                {[
                  [
                    "Stay focused.",
                    "The −15% off-type penalty will drain a diversified corp. Pick a primary type and stick to it.",
                  ],
                  [
                    "Scout states before expanding.",
                    "Check unemployment, crime, grid reliability, and corruption on the state page before buying in. High unemployment is actually better for your margins.",
                  ],
                  [
                    "Expand in your home country first.",
                    "The +5% same-country bonus (and +10% in your HQ state) makes domestic expansion significantly cheaper to sustain.",
                  ],
                  [
                    "Don't over-split.",
                    "MS escalation doubles with each split. Wait a turn or two for costs to decay before splitting again.",
                  ],
                  [
                    "Watch the commodity pages.",
                    "If a commodity your sectors supply is in shortage, your margins are boosted. If oversupplied, consider switching strategies.",
                  ],
                  [
                    "Never leave the CEO seat vacant.",
                    "A corp without a CEO bleeds 10% of sector revenue per turn into the unowned pool. Fill vacancies immediately.",
                  ],
                  [
                    "Subsidies stack.",
                    "A federal + state subsidy on your primary sector type = +30 percentage points. Push for both.",
                  ],
                  [
                    "Invest in Logistics & Operations Strength early.",
                    "Raise it before you hit 15 sectors so the threshold is already extended when you need it.",
                  ],
                  [
                    "Use bonds before equity issuance.",
                    "Bonds are cheaper than diluting your shares as long as your credit rating stays healthy.",
                  ],
                  [
                    "Retain capital early, pay dividends later.",
                    "Young corps need capital for expansion and logistics. Once established, dividends reward your holdings.",
                  ],
                  [
                    "Watch national macro.",
                    "Inflation above 2% and sovereign debt above 50% of GDP directly cut your margins. These are worth watching on the national metrics page.",
                  ],
                ].map(([bold, rest]) => (
                  <li key={String(bold)} className="flex gap-2">
                    <span className="mt-0.5 text-primary">•</span>
                    <span>
                      <strong className="text-foreground">{bold}</strong> {rest}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>

        {/* Footer nav */}
        <div className="mt-10 flex items-center justify-between border-t border-card-border pt-6 text-sm text-muted">
          <Link
            href="/guides"
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            All Guides
          </Link>
          <Link href="/stockmarket/us" className="hover:text-foreground transition-colors">
            NYSE →
          </Link>
        </div>
      </div>
    </div>
  );
}

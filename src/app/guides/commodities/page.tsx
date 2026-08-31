import type { Metadata } from "next";
import Link from "next/link";
import { publicPageMetadata } from "@/lib/siteMetadata";

export const metadata: Metadata = publicPageMetadata({
  title: "Commodities Guide | A House Divided",
  description:
    "How commodities work in A House Divided: supply and demand, sector input and output chains, margin effects, operating strategies, and how to read the market.",
  pathname: "/guides/commodities",
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
  { id: "overview", label: "How the Market Works" },
  { id: "pricing", label: "Pricing Formula" },
  { id: "margin-effects", label: "Margin Effects" },
  { id: "sector-supply", label: "What Each Sector Supplies" },
  { id: "sector-demand", label: "What Each Sector Demands" },
  { id: "retail-hub", label: "Retail: The Demand Hub" },
  { id: "financial-rate", label: "Financial Services & Interest Rates" },
  { id: "strategies", label: "Operating Strategies" },
  { id: "strategy-list", label: "Strategy Reference" },
  { id: "tips", label: "Operating Tips" },
];

export default function CommoditiesGuidePage() {
  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-10">
        {/* Breadcrumb */}
        <nav className="mb-6 flex items-center gap-1.5 text-sm text-muted">
          <Link href="/guides" className="hover:text-foreground transition-colors">
            Guides
          </Link>
          <span>/</span>
          <span className="text-foreground">Commodities</span>
        </nav>

        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Commodities</h1>
          <p className="mt-2 text-sm text-muted">
            Supply and demand, margin effects, sector chains, and operating strategy
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

          {/* ── 1. Overview ── */}
          <section className="space-y-4">
            <SectionHeader id="overview">1. How the Market Works</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              The commodity market connects corporations through 22 traded goods. Sectors that
              produce certain goods <strong className="text-foreground">add to supply</strong>;
              sectors that consume them <strong className="text-foreground">add to demand</strong>.
              When supply is short, buyers pay a margin penalty. When supply exceeds demand, buyers
              get a bonus and sellers are squeezed. Only owned sectors participate - unowned sectors
              contribute nothing to either side.
            </p>
            <Callout variant="info">
              Planned economies work differently: national prices can be administered by the plan
              instead of tracking market S/D. See{" "}
              <Link href="/guides/planned-economies" className="text-primary hover:underline">
                Planned / Command Economies
              </Link>
              .
            </Callout>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Steel", "Manufacturing, Construction, Automobiles"],
                ["Electronics", "Technology, Defense, Healthcare, Telecom"],
                ["Energy (Elec.)", "Energy sector"],
                ["Industrial Chemicals", "Chemical Industries"],
                ["Pharmaceuticals", "Chemical Industries (Pharma strategy)"],
                ["Fertilizers", "Chemical Industries (Fertilizer strategy)"],
                ["Food", "Agriculture"],
                ["Building Materials", "Manufacturing"],
                ["Construction Services", "Construction"],
                ["Healthcare Services", "Healthcare"],
                ["Real Estate Services", "Real Estate"],
                ["Software", "Technology, Telecom, Financial (Fintech)"],
                ["Financial Services", "Financial sector"],
                ["Advertising", "Media, Entertainment"],
                ["Vehicles", "Automobiles, Defense"],
                ["Consumer Goods", "Retail"],
                ["Freight", "Logistics"],
                ["Consulting Services", "Logistics"],
                ["Iron Ore", "Extraction"],
                ["Coal", "Extraction"],
                ["Crude Oil", "Extraction"],
                ["Rare Earth Minerals", "Extraction"],
              ].map(([name, source]) => (
                <div
                  key={name}
                  className="rounded-lg border border-card-border bg-card p-3 space-y-0.5"
                >
                  <p className="text-xs font-semibold text-foreground">{name}</p>
                  <p className="text-xs text-muted">{source}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ── 2. Pricing ── */}
          <section className="space-y-4">
            <SectionHeader id="pricing">2. Pricing Formula</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Commodity prices update every turn from the global supply/demand balance, blended with
              country-aggregate (national) and state-level conditions. (In planned economies the
              national leg may be administered rather than S/D-cleared; see{" "}
              <Link href="/guides/planned-economies" className="text-primary hover:underline">
                Planned Economies
              </Link>
              .)
            </p>
            <p className="text-sm text-muted leading-relaxed">
              In short: prices rise when demand outstrips supply and fall when supply outstrips
              demand, but the curve is logarithmic, so the first bit of shortage moves price a lot
              and each further bit moves it less. No ratio sends price to infinity.
            </p>
            <FormulaBlock>{`rawRatio = demand / supply
effectiveRatio = rawRatio through 3x shortage or 3x oversupply
above 3x, effective pressure keeps rising at 25% of the raw log tail

Market price:
  If effectiveRatio ≥ 1: basePrice × (1 + 0.7 × ln(effectiveRatio))
  If effectiveRatio < 1: basePrice / (1 + 0.7 × |ln(effectiveRatio)|)

Blended price per state = 50% global + 25% national + 25% regional (state)
  Macro-driven commodities (financial, healthcare, advertising,
  real estate services): regional leg redirects to national, so the
  effective blend becomes 50% global + 50% national.

Examples:
  demand/supply = 1.0 (balanced)  → price = basePrice        (no change)
  demand/supply = 1.5 (shortage)  → price = basePrice × 1.28  (+28%)
  demand/supply = 2.0 (severe)    → price = basePrice × 1.49  (+49%)
  demand/supply = 5.0 (acute)     → effective 3.41×, price × 1.86 (+86%)
  demand/supply = 0.5 (oversupply)→ price = basePrice × 0.67  (−33%)`}</FormulaBlock>
            <p className="text-sm text-muted leading-relaxed">
              Raw D/S stays visible on market screens. Prices use the effective ratio, so extreme
              ratios continue to push prices without turning every imbalance above 3x into a runaway
              shock.
            </p>
            <p className="text-sm text-muted leading-relaxed">
              Global trends still anchor most of the price, but a state with unusual local
              production or demand, and a country whose national S/D diverges from the world, both
              tilt the blend. Corporations operating in states with heavy local supply, or in
              countries that are net exporters of an input, benefit from lower input costs.
            </p>
          </section>

          {/* ── 3. Margin Effects ── */}
          <section className="space-y-4">
            <SectionHeader id="margin-effects">3. Margin Effects</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Commodity shortages and surpluses feed directly into your corporation&apos;s profit
              margin through a <strong className="text-foreground">logarithmic modifier</strong>:
            </p>
            <FormulaBlock>{`Margin modifier = −K × Σ(rate_i × ln(effective D/S_i))

K = 40 (scaling constant)
rate_i = how intensively this sector uses commodity i (see tables below)
effective D/S = raw D/S up to 3x, softened beyond 3x

  Buyers (inputs): shortage → negative modifier (higher costs compress margins)
                   surplus  → positive modifier (cheaper inputs boost margins)
  Sellers (outputs): shortage → positive modifier (your goods are more valuable)
                     surplus  → negative modifier (your goods are worth less)`}</FormulaBlock>
            <p className="text-sm text-muted leading-relaxed">
              Reference table for a single commodity at demand rate 0.25 (typical for a heavy
              input):
            </p>
            <div className="overflow-x-auto rounded-xl border border-card-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card">
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">
                      Raw D/S ratio
                    </th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">
                      Market condition
                    </th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">
                      Buyer margin impact
                    </th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">
                      Seller margin impact
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/60">
                  {[
                    [
                      "0.5×",
                      "Heavy oversupply",
                      <Tag key="b05" variant="positive">
                        +6.9%
                      </Tag>,
                      <Tag key="s05" variant="negative">
                        −6.9%
                      </Tag>,
                    ],
                    ["1× (balanced)", "Neutral", "0%", "0%"],
                    [
                      "1.1×",
                      "Mild shortage",
                      <Tag key="b11" variant="negative">
                        −1.1%
                      </Tag>,
                      <Tag key="s11" variant="positive">
                        +1.1%
                      </Tag>,
                    ],
                    [
                      "1.4×",
                      "Moderate shortage",
                      <Tag key="b14" variant="negative">
                        −3.4%
                      </Tag>,
                      <Tag key="s14" variant="positive">
                        +3.4%
                      </Tag>,
                    ],
                    [
                      "2×",
                      "Severe shortage",
                      <Tag key="b2" variant="negative">
                        −6.9%
                      </Tag>,
                      <Tag key="s2" variant="positive">
                        +6.9%
                      </Tag>,
                    ],
                    [
                      "5×",
                      "Extreme shortage",
                      <Tag key="b5" variant="negative">
                        −12.3%
                      </Tag>,
                      <Tag key="s5" variant="positive">
                        +12.3%
                      </Tag>,
                    ],
                  ].map(([ratio, cond, buyer, seller]) => (
                    <tr key={ratio as string}>
                      <td className="px-4 py-2.5 text-muted font-mono">{ratio}</td>
                      <td className="px-4 py-2.5 text-muted">{cond}</td>
                      <td className="px-4 py-2.5">{buyer}</td>
                      <td className="px-4 py-2.5">{seller}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Callout variant="info">
              <strong className="text-foreground">Multiple commodities stack.</strong> A defense
              sector facing steel shortage at −3.4% and electronics shortage at −4.3% sees a
              combined −7.7% margin hit. Sectors with many inputs are more exposed than sectors with
              few. Each commodity is soft-capped at ±50 percentage points of contribution before
              stacking.
            </Callout>
            <Callout variant="tip">
              <strong className="text-foreground">
                Retail absorbs only 25% of negative penalties.
              </strong>{" "}
              Retail sectors have built-in resilience to input shortages. A shortage that hits a
              manufacturing sector for −6.9% only hits a retail sector for −1.7% on the same
              commodity. Positive bonuses from oversupply are unaffected.
            </Callout>
          </section>

          {/* ── 4. Sector Supply ── */}
          <section className="space-y-4">
            <SectionHeader id="sector-supply">4. What Each Sector Supplies</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Supply rates are fractions of sector daily revenue. A sector generating $1M/day at
              supply rate 0.4 pushes $400k worth of that commodity into the market every day.
            </p>
            <div className="overflow-x-auto rounded-xl border border-card-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card">
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Sector</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Supplies</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/60">
                  {[
                    ["Manufacturing", "Steel / Building Materials", "0.40 / 0.20"],
                    ["Technology", "Electronics / Software", "0.35 / 0.35"],
                    ["Energy", "Electricity", "0.60"],
                    ["Chemical Industries", "Industrial Chemicals", "0.50"],
                    ["Healthcare", "Healthcare Services", "0.50"],
                    ["Agriculture", "Food", "0.50"],
                    ["Automobiles", "Vehicles", "0.50"],
                    ["Financial", "Financial Services", "0.50"],
                    ["Media", "Advertising", "0.50"],
                    ["Defense", "Vehicles / Electronics", "0.20 / 0.15"],
                    ["Real Estate", "Real Estate Services", "0.45"],
                    ["Construction", "Construction Services", "0.45"],
                    ["Telecommunications", "Software", "0.20"],
                    ["Entertainment", "Advertising", "0.20"],
                    ["Retail", "Consumer Goods", "0.50"],
                    ["Logistics", "Freight / Consulting Services", "0.45 / 0.25"],
                    [
                      "Extraction",
                      "Iron Ore / Coal / Crude Oil / Rare Earth",
                      "0.25 / 0.20 / 0.20 / 0.10",
                    ],
                  ].map(([sector, commodity, rate]) => (
                    <tr key={sector}>
                      <td className="px-4 py-2.5 text-foreground font-medium">{sector}</td>
                      <td className="px-4 py-2.5 text-muted">{commodity}</td>
                      <td className="px-4 py-2.5 text-muted font-mono">{rate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── 5. Sector Demand ── */}
          <section className="space-y-4">
            <SectionHeader id="sector-demand">5. What Each Sector Demands</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              These are the inputs each sector type consumes. The rates shown are per-unit fractions
              of daily revenue - higher rates mean the sector is more sensitive to that
              commodity&apos;s price swings.
            </p>
            <div className="overflow-x-auto rounded-xl border border-card-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card">
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Sector</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">
                      Key inputs (highest rate first)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/60">
                  {[
                    [
                      "Manufacturing",
                      "Energy 0.20, Iron Ore 0.15, Coal 0.10, Electronics 0.10, Freight 0.10",
                    ],
                    ["Technology", "Energy 0.15, Rare Earth 0.08, Consulting 0.08, Steel 0.05"],
                    ["Energy", "Steel 0.15, Coal 0.15, Oil 0.10, Vehicles 0.10, Construction 0.05"],
                    ["Chemical Industries", "Energy 0.18, Crude Oil 0.15, Freight 0.08"],
                    [
                      "Healthcare",
                      "Pharmaceuticals 0.15, Electronics 0.15, Software 0.12, Energy 0.05",
                    ],
                    ["Agriculture", "Fertilizers 0.15, Vehicles 0.10, Energy 0.10, Freight 0.08"],
                    [
                      "Automobiles",
                      "Steel 0.25, Electronics 0.15, Iron 0.10, Energy 0.10, Freight 0.08",
                    ],
                    ["Financial", "Software 0.20, Consulting 0.10, Electronics 0.05"],
                    ["Media", "Software 0.15, Electronics 0.10, Consulting 0.06"],
                    [
                      "Defense",
                      "Steel 0.20, Electronics 0.20, Iron 0.10, Software 0.10, Rare Earth 0.05",
                    ],
                    [
                      "Real Estate",
                      "Construction Services 0.20, Financial Services 0.15, Building Materials 0.12, Steel 0.08, Energy 0.08",
                    ],
                    [
                      "Construction",
                      "Building Materials 0.25, Steel 0.15, Energy 0.12, Vehicles 0.10",
                    ],
                    [
                      "Telecommunications",
                      "Electronics 0.25, Energy 0.10, Construction 0.08, Building Materials 0.06",
                    ],
                    ["Entertainment", "Software 0.15, Electronics 0.10, Energy 0.06"],
                    ["Logistics", "Energy 0.20, Vehicles 0.20, Software 0.10"],
                    ["Extraction", "Energy 0.20, Vehicles 0.15, Freight 0.10, Chemicals 0.08"],
                  ].map(([sector, inputs]) => (
                    <tr key={sector}>
                      <td className="px-4 py-2.5 text-foreground font-medium align-top">
                        {sector}
                      </td>
                      <td className="px-4 py-2.5 text-muted">{inputs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── 6. Retail ── */}
          <section className="space-y-4">
            <SectionHeader id="retail-hub">6. Retail and Household Demand</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Retail supplies the Consumer Goods commodity. Its customers come from the household
              consumption ledger, independently of how much Retail capacity exists. Population,
              income, employment, consumer confidence, and prices determine what households buy.
              Opening more stores therefore competes for existing demand instead of creating new
              customers.
            </p>
            <FormulaBlock>{`Household demand = population × per-capita budget
  × employment factor
  × consumer-confidence factor
  × relative-income factor
  × commodity basket share
  × bounded price elasticity`}</FormulaBlock>
            <p className="text-sm text-muted leading-relaxed">
              Consumer purchases also create final demand for food, energy, vehicles, electronics,
              healthcare, entertainment, and other household goods and services. Those purchases are
              counted once by households, not duplicated as a Retail-sector input proxy.
            </p>
            <Callout variant="info">
              <strong className="text-foreground">Retail can saturate.</strong> Excess stores lower
              seller fill and revenue. Shortages raise prices and create room for competitors to
              build. Retail follows the same supply-and-demand discipline as every other sector.
            </Callout>
          </section>

          {/* ── 7. Financial Services & Rates ── */}
          <section className="space-y-4">
            <SectionHeader id="financial-rate">
              7. Financial Services &amp; Interest Rates
            </SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Financial Services commodity demand has a built-in sensitivity to the central bank
              prime rate. Cheap money means more borrowing, M&amp;A activity, and mortgage
              refinancing - all of which drive demand for financial sector output.
            </p>
            <FormulaBlock>{`Rate multiplier = 1 + (2.75 - primeRate) × 0.12

Clamped to: 0.6× minimum, 1.4× maximum

Examples:
  Prime rate 1%:   multiplier ≈ 1.21 → +21% financial services demand
  Prime rate 2.75%: multiplier = 1.00 → neutral
  Prime rate 5%:   multiplier ≈ 0.73 → −27% financial services demand
  Prime rate 8%:   multiplier = 0.60 → −40% demand (floor)`}</FormulaBlock>
            <p className="text-sm text-muted leading-relaxed">
              Additionally, government debt issuance drives latent financial services demand - more
              bond issuance means more underwriting activity, which feeds into Financial Services
              commodity demand. A country running large deficits and issuing heavy bond supply will
              sustain elevated Financial Services demand independent of interest rates.
            </p>
          </section>

          {/* ── 8. Operating Strategies ── */}
          <section className="space-y-4">
            <SectionHeader id="strategies">8. Operating Strategies</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Each sector can switch between 2-3 operating strategies that change its commodity
              supply and demand rates. Strategies have no direct margin modifier - all effects come
              through commodity market prices. Choose a strategy based on which commodities are in
              shortage (supplies you can profit from) or oversupply (inputs you want to minimize).
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                {
                  title: "Switch cost",
                  body: "25% of the sector's daily revenue, paid upfront.",
                },
                {
                  title: "Transition time",
                  body: "12 turns with a −5% margin penalty during the transition period.",
                },
                {
                  title: "Cooldown",
                  body: "24 turns from initiation before you can switch again.",
                },
              ].map(({ title, body }) => (
                <div
                  key={title}
                  className="rounded-xl border border-card-border bg-card p-4 space-y-1.5"
                >
                  <p className="text-xs font-bold uppercase tracking-wider text-muted">{title}</p>
                  <p className="text-sm text-muted leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
            <Callout variant="warn">
              <strong className="text-foreground">
                Time switches to market conditions, not theory.
              </strong>{" "}
              The strategy confirmation panel shows the current market status of every commodity
              your new strategy would add or remove. Only switch if the market is already aligned -
              switching to a strategy that produces an oversupplied commodity will immediately
              compress your margins.
            </Callout>
          </section>

          {/* ── 9. Strategy Reference ── */}
          <section className="space-y-4">
            <SectionHeader id="strategy-list">9. Strategy Reference</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Each sector&apos;s available strategies and how they shift commodity flows:
            </p>

            {[
              {
                sector: "Energy",
                strategies: [
                  {
                    name: "Conventional",
                    supply: "Electricity 0.60",
                    demand: "Steel, Coal, Oil, Vehicles, Construction",
                    note: "Baseline fossil-fuel output",
                  },
                  {
                    name: "Renewables Focus",
                    supply: "Electricity 0.50",
                    demand: "Electronics, Rare Earth, Building Materials, Steel",
                    note: "Lower output; pivots from fossil to electronics-heavy inputs",
                  },
                  {
                    name: "Nuclear Expansion",
                    supply: "Electricity 0.70",
                    demand: "Steel, Chemicals, Consulting, Construction",
                    note: "Highest electricity output; demands steel and chemicals heavily",
                  },
                ],
              },
              {
                sector: "Manufacturing",
                strategies: [
                  {
                    name: "Standard",
                    supply: "Steel 0.40, Building Materials 0.20",
                    demand: "Energy, Iron, Coal, Electronics, Freight",
                    note: "Balanced; two commodities supplied",
                  },
                  {
                    name: "Heavy Metals",
                    supply: "Steel 0.55",
                    demand: "Iron 0.25, Coal 0.20, Energy",
                    note: "More steel output; heavier iron and coal draw",
                  },
                  {
                    name: "Electronics Manufacturing",
                    supply: "Electronics 0.30, Steel 0.20",
                    demand: "Rare Earth, Iron, Energy, Chemicals",
                    note: "Adds electronics supply; demands rare earth",
                  },
                ],
              },
              {
                sector: "Technology",
                strategies: [
                  {
                    name: "Standard",
                    supply: "Electronics 0.35, Software 0.35",
                    demand: "Energy, Rare Earth, Steel, Consulting",
                    note: "Balanced split",
                  },
                  {
                    name: "Hardware Focus",
                    supply: "Electronics 0.55, Software 0.15",
                    demand: "Energy, Rare Earth, Steel, Chemicals",
                    note: "Higher electronics supply; more raw material demand",
                  },
                  {
                    name: "Software Focus",
                    supply: "Software 0.55, Electronics 0.15",
                    demand: "Consulting, Energy",
                    note: "Lowest raw material demand; most consulting-intensive",
                  },
                ],
              },
              {
                sector: "Chemical Industries",
                strategies: [
                  {
                    name: "Industrial Chemicals",
                    supply: "Chemicals 0.50",
                    demand: "Energy, Oil, Freight",
                    note: "Default; broad industrial chemicals supply",
                  },
                  {
                    name: "Fertilizer Production",
                    supply: "Fertilizers 0.50, Chemicals 0.10",
                    demand: "Chemicals, Energy, Oil",
                    note: "Useful when agriculture sector is large and demanding fertilizers",
                  },
                  {
                    name: "Pharmaceuticals",
                    supply: "Pharmaceuticals 0.45, Chemicals 0.10",
                    demand: "Chemicals, Electronics, Software, Energy",
                    note: "High-value; useful when healthcare sector is demanding pharma",
                  },
                ],
              },
              {
                sector: "Agriculture",
                strategies: [
                  {
                    name: "Traditional",
                    supply: "Food 0.50",
                    demand: "Fertilizers, Vehicles, Energy, Freight",
                    note: "Baseline",
                  },
                  {
                    name: "Industrial",
                    supply: "Food 0.60",
                    demand: "Fertilizers 0.25, Energy, Oil, Vehicles",
                    note: "Higher output; heavy fertilizer and oil draw",
                  },
                  {
                    name: "Sustainable",
                    supply: "Food 0.40",
                    demand: "Fertilizers 0.05, Software, Freight",
                    note: "Lower output; minimal fertilizer dependence; pivot away from shortage",
                  },
                ],
              },
              {
                sector: "Healthcare",
                strategies: [
                  {
                    name: "Standard",
                    supply: "Healthcare Services 0.50",
                    demand: "Pharmaceuticals, Electronics, Software, Energy",
                    note: "Balanced delivery model",
                  },
                  {
                    name: "Hospital Networks",
                    supply: "Healthcare Services 0.60",
                    demand: "Pharmaceuticals 0.18, Electronics 0.20, Software",
                    note: "Higher output; more resource intensive",
                  },
                  {
                    name: "Outpatient & Preventive",
                    supply: "Healthcare Services 0.45",
                    demand: "Pharmaceuticals 0.12, Software 0.16, Consulting",
                    note: "Lower output; lighter facilities; software-heavy",
                  },
                ],
              },
              {
                sector: "Automobiles",
                strategies: [
                  {
                    name: "Standard",
                    supply: "Vehicles 0.50",
                    demand: "Steel 0.25, Electronics 0.15, Iron, Energy, Freight",
                    note: "ICE-focused; steel-intensive",
                  },
                  {
                    name: "EV Focus",
                    supply: "Vehicles 0.45",
                    demand: "Electronics 0.30, Rare Earth, Energy, Software",
                    note: "No steel or iron; very electronics and rare earth heavy",
                  },
                  {
                    name: "Heavy Machinery",
                    supply: "Vehicles 0.55",
                    demand: "Steel 0.35, Iron, Energy, Freight",
                    note: "Highest vehicle output; most steel-intensive",
                  },
                ],
              },
              {
                sector: "Financial",
                strategies: [
                  {
                    name: "Standard",
                    supply: "Financial Services 0.50",
                    demand: "Software, Consulting, Electronics",
                    note: "Traditional banking",
                  },
                  {
                    name: "Fintech",
                    supply: "Financial Services 0.45, Software 0.15",
                    demand: "Software 0.25, Electronics",
                    note: "Adds software supply alongside financial services",
                  },
                  {
                    name: "Traditional Banking",
                    supply: "Financial Services 0.55",
                    demand: "Consulting 0.15, Real Estate",
                    note: "Highest financial services output; consulting and space heavy",
                  },
                ],
              },
              {
                sector: "Media",
                strategies: [
                  {
                    name: "Standard",
                    supply: "Advertising 0.50",
                    demand: "Software, Electronics, Consulting",
                    note: "Balanced",
                  },
                  {
                    name: "Digital-First",
                    supply: "Advertising 0.40, Software 0.15",
                    demand: "Software 0.20, Electronics",
                    note: "Adds software supply; useful when software is in surplus",
                  },
                  {
                    name: "Legacy Broadcast",
                    supply: "Advertising 0.55",
                    demand: "Electronics 0.15, Energy",
                    note: "Highest advertising output; no software demand",
                  },
                ],
              },
              {
                sector: "Defense",
                strategies: [
                  {
                    name: "Standard",
                    supply: "Vehicles 0.20, Electronics 0.15",
                    demand: "Steel 0.20, Electronics 0.20, Iron, Software, Rare Earth",
                    note: "Balanced; net electronics consumer despite small supply",
                  },
                  {
                    name: "Cyber Warfare",
                    supply: "Electronics 0.25, Software 0.20",
                    demand: "Software 0.20, Electronics 0.15, Consulting",
                    note: "Switches to software/electronics production; no steel or vehicles",
                  },
                  {
                    name: "Heavy Armor",
                    supply: "Vehicles 0.35",
                    demand: "Steel 0.30, Iron, Energy, Freight",
                    note: "Highest vehicle output; extremely steel-intensive; drops rare earth and software",
                  },
                ],
              },
              {
                sector: "Real Estate",
                strategies: [
                  {
                    name: "Standard",
                    supply: "Real Estate Services 0.45",
                    demand:
                      "Construction Services, Financial Services, Building Materials, Steel, Energy",
                    note: "Balanced residential and commercial",
                  },
                  {
                    name: "Commercial Development",
                    supply: "Real Estate Services 0.50",
                    demand:
                      "Construction Services 0.25, Financial Services 0.20, Steel, Consulting",
                    note: "Higher output; heavier financing and construction needs",
                  },
                  {
                    name: "Green Building",
                    supply: "Real Estate Services 0.38",
                    demand: "Construction Services, Electronics 0.15, Software, Building Materials",
                    note: "Lower output; technology-heavy inputs for efficient buildings",
                  },
                ],
              },
              {
                sector: "Construction",
                strategies: [
                  {
                    name: "General Contracting",
                    supply: "Construction Services 0.45",
                    demand: "Building Materials 0.25, Steel 0.15, Energy, Vehicles",
                    note: "Balanced residential, commercial, and civil work",
                  },
                  {
                    name: "Infrastructure Buildout",
                    supply: "Construction Services 0.55",
                    demand: "Building Materials 0.30, Steel 0.20, Energy, Vehicles, Consulting",
                    note: "Highest output; very materials-intensive",
                  },
                  {
                    name: "Modular Construction",
                    supply: "Construction Services 0.40",
                    demand: "Building Materials 0.18, Electronics 0.12, Steel, Software, Energy",
                    note: "Lower raw-material intensity; more tech inputs",
                  },
                ],
              },
              {
                sector: "Telecommunications",
                strategies: [
                  {
                    name: "Standard",
                    supply: "Software 0.20",
                    demand: "Electronics 0.25, Energy, Construction Services, Building Materials",
                    note: "Traditional telecom infrastructure",
                  },
                  {
                    name: "5G/Infrastructure",
                    supply: "Software 0.15",
                    demand: "Electronics 0.35, Energy, Steel, Construction, Rare Earth",
                    note: "Heavy hardware investment for next-gen networks",
                  },
                  {
                    name: "Cloud Services",
                    supply: "Software 0.35",
                    demand: "Energy 0.20, Electronics 0.15",
                    note: "Highest software output; energy-intensive data centers",
                  },
                ],
              },
              {
                sector: "Entertainment",
                strategies: [
                  {
                    name: "Standard",
                    supply: "Advertising 0.20",
                    demand: "Software 0.15, Electronics 0.10, Energy",
                    note: "Mixed studios, venues, and digital content",
                  },
                  {
                    name: "Streaming/Digital",
                    supply: "Advertising 0.15, Software 0.10",
                    demand: "Software 0.20, Energy 0.10",
                    note: "Digital-first; co-produces software",
                  },
                  {
                    name: "Live/Venue",
                    supply: "Advertising 0.25",
                    demand: "Construction Services 0.12, Energy, Freight, Building Materials",
                    note: "Highest advertising output; physical infrastructure needs",
                  },
                ],
              },
              {
                sector: "Retail",
                strategies: [
                  {
                    name: "Standard",
                    supply: "Consumer Goods 0.50",
                    demand:
                      "Food, Electronics, Energy, Vehicles, Freight, Advertising, Software, and others",
                    note: "Mixed online and physical retail",
                  },
                  {
                    name: "E-Commerce",
                    supply: "Consumer Goods 0.35, Software 0.10",
                    demand: "Software 0.10, Freight 0.12, Electronics, Advertising",
                    note: "Online-first; co-produces software platforms",
                  },
                  {
                    name: "Brick & Mortar",
                    supply: "Consumer Goods 0.55",
                    demand: "Real Estate Services 0.12, Energy 0.12, Advertising, Food, Freight",
                    note: "Highest retail output; physical infrastructure costs",
                  },
                ],
              },
              {
                sector: "Logistics",
                strategies: [
                  {
                    name: "Standard",
                    supply: "Freight 0.45, Consulting Services 0.25",
                    demand: "Vehicles 0.20, Energy 0.20, Software",
                    note: "Traditional freight and consulting",
                  },
                  {
                    name: "Automated Logistics",
                    supply: "Freight 0.50, Consulting Services 0.15",
                    demand: "Software 0.20, Electronics 0.15, Energy",
                    note: "Higher freight throughput; tech-intensive",
                  },
                  {
                    name: "Full-Service",
                    supply: "Freight 0.40, Consulting Services 0.35",
                    demand: "Vehicles 0.25, Energy 0.20, Software 0.15",
                    note: "End-to-end supply chain; consulting-heavy",
                  },
                ],
              },
              {
                sector: "Extraction",
                strategies: [
                  {
                    name: "Diversified",
                    supply: "Iron Ore 0.25, Coal 0.20, Crude Oil 0.20, Rare Earth 0.10",
                    demand: "Energy 0.20, Vehicles 0.15, Freight, Chemicals",
                    note: "Balanced mining; broad but lower per-resource output",
                  },
                  {
                    name: "Iron & Metals Mining",
                    supply: "Iron Ore 0.55",
                    demand: "Energy 0.25, Vehicles 0.15, Freight, Steel",
                    note: "Sole output: iron ore at maximum volume",
                  },
                  {
                    name: "Oil & Gas",
                    supply: "Crude Oil 0.55",
                    demand: "Energy 0.20, Chemicals 0.15, Steel, Vehicles",
                    note: "Sole output: crude oil at maximum volume",
                  },
                  {
                    name: "Rare Earth Mining",
                    supply: "Rare Earth 0.45",
                    demand: "Energy 0.25, Chemicals 0.20, Vehicles, Freight",
                    note: "Sole output: rare earth; chemical-intensive processing",
                  },
                  {
                    name: "Coal Mining",
                    supply: "Coal 0.55",
                    demand: "Energy 0.20, Vehicles 0.15, Freight 0.15",
                    note: "Sole output: coal at maximum volume",
                  },
                ],
              },
            ].map(({ sector, strategies }) => (
              <div key={sector} className="space-y-2">
                <SubHeader>{sector}</SubHeader>
                <div className="overflow-x-auto rounded-xl border border-card-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-card-border bg-card">
                        <th className="px-3 py-2 text-left font-semibold text-muted">Strategy</th>
                        <th className="px-3 py-2 text-left font-semibold text-muted">Supply</th>
                        <th className="px-3 py-2 text-left font-semibold text-muted">Key inputs</th>
                        <th className="px-3 py-2 text-left font-semibold text-muted">
                          When to use
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-card-border/60">
                      {strategies.map(({ name, supply, demand, note }) => (
                        <tr key={name}>
                          <td className="px-3 py-2 text-foreground font-medium">{name}</td>
                          <td className="px-3 py-2 text-muted">{supply}</td>
                          <td className="px-3 py-2 text-muted">{demand}</td>
                          <td className="px-3 py-2 text-muted">{note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </section>

          {/* ── 10. Tips ── */}
          <section className="space-y-4">
            <SectionHeader id="tips">10. Operating Tips</SectionHeader>
            <ul className="space-y-3 text-sm text-muted">
              {[
                [
                  "Check the commodity page before switching strategy.",
                  "The strategy confirmation panel shows live market status for every affected commodity. If your new supply commodity is already in surplus, you will sell into a flooded market. If your new input commodity is in shortage, you will pay a premium from day one.",
                ],
                [
                  "Extraction is the upstream lever.",
                  "Iron Ore, Coal, Crude Oil, and Rare Earth Minerals flow into Manufacturing, Energy, Technology, Chemicals, and Automobiles. A global shortage of rare earth minerals hits defense, tech, and EV automobiles simultaneously. An extraction sector benefits from that shortage; everyone else suffers.",
                ],
                [
                  "Technology and Defense are in commodity competition.",
                  "Both consume electronics and software. When Defense scales up (heavy government spending), it competes directly with Technology for electronics, driving up the price for both. Defense also supplies electronics at a lower rate than it consumes - it is a net electronics buyer.",
                ],
                [
                  "Agriculture and Chemical Industries are linked.",
                  "Industrial Agriculture demands fertilizers heavily (0.25 rate). Fertilizer Production in Chemical Industries supplies them. If agriculture is large and all Chemical Industries are on standard Industrial Chemicals strategy, fertilizers will be in shortage. Switch a chemical sector to Fertilizer Production when you see that gap.",
                ],
                [
                  "Renewables and EV both demand rare earth.",
                  "Renewables Focus (Energy) and EV Focus (Automobiles) both depend heavily on rare earth minerals (0.10 and 0.10 rates respectively). If both strategies are widely adopted, rare earth becomes one of the most contested commodities in the game. Extraction is the only supplier.",
                ],
                [
                  "Retail smooths out sector imbalances.",
                  "Retail consumes all 22 commodities at low rates, scaled by GDP. It is a constant baseline demand floor. In a contraction, retail demand shrinks and commodity shortages self-correct. In a boom, retail demand amplifies every existing imbalance.",
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

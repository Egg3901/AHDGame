import type { Metadata } from "next";
import Link from "next/link";
import { publicPageMetadata } from "@/lib/siteMetadata";

export const metadata: Metadata = publicPageMetadata({
  title: "Forex Guide | A House Divided",
  description:
    "How currency exchange works in A House Divided: exchange rate mechanics, trading tiers, volume pressure, macro fundamentals, and cross-currency strategies across the US, UK, and Japan.",
  pathname: "/guides/forex",
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

const TABLE_WRAP = "overflow-x-auto rounded-lg border border-card-border";
const TABLE = "w-full min-w-[480px] text-sm";
const TH =
  "border-b border-card-border bg-card px-3 py-2 text-left text-xs font-bold uppercase tracking-wider text-muted";
const TD = "border-b border-card-border/50 px-3 py-2 text-muted";

const TOC_ITEMS = [
  { id: "overview", label: "How Forex Works" },
  { id: "currencies", label: "Active Currencies" },
  { id: "rate-movement", label: "How Exchange Rates Move" },
  { id: "trading-tiers", label: "The Three Trading Tiers" },
  { id: "wallet", label: "The Multi-Currency Wallet" },
  { id: "foreign-income", label: "Foreign Income" },
  { id: "strategy", label: "Reading the Macro Board" },
  { id: "tips", label: "Quick Tips" },
];

export default function ForexGuidePage() {
  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-10">
        {/* Breadcrumb */}
        <nav className="mb-6 flex items-center gap-1.5 text-sm text-muted">
          <Link href="/guides" className="hover:text-foreground transition-colors">
            Guides
          </Link>
          <span>/</span>
          <span className="text-foreground">Currency Exchange (Forex)</span>
        </nav>

        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Currency Exchange (Forex)</h1>
          <p className="mt-2 text-sm text-muted">
            Exchange rate mechanics, trading tiers, volume pressure, and cross-currency strategies
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
            <SectionHeader id="overview">1. How Forex Works</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Every active country in A House Divided has its own floating currency. Exchange rates
              move each turn based on real economic conditions inside the simulation - interest
              rates, inflation, GDP growth, and trade - plus the buying and selling pressure of
              players themselves. You can trade currencies directly for profit, and every
              cross-border investment you make (foreign stocks, bonds, corporations) settles in the
              currency of the asset&apos;s country, so exchange rates flow through your whole
              portfolio whether you trade forex deliberately or not.
            </p>
            <Callout variant="info">
              Planned economies work differently: a fully command country&apos;s official rate is
              fixed and does not float with macro or player volume. See{" "}
              <Link href="/guides/planned-economies" className="text-primary hover:underline">
                Planned / Command Economies
              </Link>
              .
            </Callout>
            <p className="text-sm text-muted leading-relaxed">
              Rates are measured against an internal &ldquo;anchor&rdquo; unit rather than directly
              against each other. Cross-rates are derived from the anchors: USD/JPY is simply the
              JPY anchor rate divided by the USD anchor rate. In practice you only ever see the pair
              rates on the exchange screen.
            </p>
          </section>

          {/* ── 2. Currencies ── */}
          <section className="space-y-4">
            <SectionHeader id="currencies">2. Active Currencies</SectionHeader>
            <div className={TABLE_WRAP}>
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={TH}>Country</th>
                    <th className={TH}>Currency</th>
                    <th className={TH}>Code</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className={TD}>United States</td>
                    <td className={TD}>US Dollar</td>
                    <td className={TD}>USD</td>
                  </tr>
                  <tr>
                    <td className={TD}>United Kingdom</td>
                    <td className={TD}>Pound Sterling</td>
                    <td className={TD}>GBP</td>
                  </tr>
                  <tr>
                    <td className={TD}>Japan</td>
                    <td className={TD}>Japanese Yen</td>
                    <td className={TD}>JPY</td>
                  </tr>
                  <tr>
                    <td className={TD}>Germany / EU</td>
                    <td className={TD}>Euro</td>
                    <td className={TD}>EUR</td>
                  </tr>
                  <tr>
                    <td className={TD}>China</td>
                    <td className={TD}>Chinese Yuan</td>
                    <td className={TD}>CNY</td>
                  </tr>
                  <tr>
                    <td className={TD}>Brazil</td>
                    <td className={TD}>Brazilian Real</td>
                    <td className={TD}>BRL</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-sm text-muted leading-relaxed">
              All six currencies are tradeable. Additional currencies (like the Canadian dollar and
              Nigerian naira) have monetary baselines defined in the simulation but are not yet part
              of the trading system.
            </p>
          </section>

          {/* ── 3. Rate movement ── */}
          <section className="space-y-4">
            <SectionHeader id="rate-movement">3. How Exchange Rates Move</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Each turn, every rate updates through three components: macro fundamental drift (about
              80% of direction), player volume pressure (about 20%), and a little random noise.
            </p>

            <SubHeader>Macro fundamental drift</SubHeader>
            <p className="text-sm text-muted leading-relaxed">
              Each country&apos;s rate drifts toward a target implied by its economy relative to its
              neutral baseline:
            </p>
            <FormulaBlock>
              {`macroTarget = baseRate × max(0.01, 1
  − (primeRate − baselinePrime)         × 0.02   // higher rates → stronger currency
  + (inflationRate − baselineInflation) × 0.015  // higher inflation → weaker currency
  − (gdpGrowth − baselineGDP)           × 0.01   // higher growth → stronger currency
  − (tradeGrowth − baselineTrade)       × 0.005  // trade surplus → stronger currency
)`}
            </FormulaBlock>
            <p className="text-sm text-muted leading-relaxed">
              The rate closes 5% of the gap to its target every turn, so a significant shock takes
              roughly a full game year (~48 turns) to converge 90% of the way. That is deliberate:
              currency moves are multi-month trends you have time to spot, position for, and exit.
              Not one-turn lottery tickets.
            </p>
            <Callout variant="info">
              Example: if the US central bank hikes the prime rate from 3.0% to 5.0%, the USD macro
              target strengthens by about 4% (2.0 points of excess × 0.02 sensitivity), and the spot
              rate grinds toward it turn after turn.
            </Callout>

            <SubHeader>Player volume pressure</SubHeader>
            <p className="text-sm text-muted leading-relaxed">
              Net buy/sell volume over the past 24 turns creates a short-term offset, capped at ±5%,
              which feeds in at 20% weight. Heavy buying strengthens a currency a little and
              temporarily; it cannot overpower fundamentals, and whales cannot force extreme swings.
            </p>

            <SubHeader>Noise and guardrails</SubHeader>
            <p className="text-sm text-muted leading-relaxed">
              A ±0.3% per-turn jitter keeps movements from being perfectly predictable, and every
              rate is hard-capped at ±50% from its base rate. A currency cannot hyperinflate to zero
              or moon without limit.
            </p>
          </section>

          {/* ── 4. Trading tiers ── */}
          <section className="space-y-4">
            <SectionHeader id="trading-tiers">4. The Three Trading Tiers</SectionHeader>
            <div className={TABLE_WRAP}>
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={TH}>Tier</th>
                    <th className={TH}>Method</th>
                    <th className={TH}>Spread</th>
                    <th className={TH}>Fill</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className={TD}>1</td>
                    <td className={TD}>Market maker</td>
                    <td className={TD}>0.275%</td>
                    <td className={TD}>Instant, always available</td>
                  </tr>
                  <tr>
                    <td className={TD}>2</td>
                    <td className={TD}>Public limit order</td>
                    <td className={TD}>0.175%</td>
                    <td className={TD}>When the market crosses your limit</td>
                  </tr>
                  <tr>
                    <td className={TD}>3</td>
                    <td className={TD}>Direct player trade</td>
                    <td className={TD}>0.10%</td>
                    <td className={TD}>When the target player accepts</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-sm text-muted leading-relaxed">
              <strong className="text-foreground">Tier 1 (market maker)</strong> fills instantly at
              the current rate plus a 0.275% spread. It is also what auto-convert uses when you buy
              a foreign asset without holding that currency.{" "}
              <strong className="text-foreground">Tier 2 (limit orders)</strong> post publicly at
              your target rate and auto-fill when the market crosses it, for a cheaper 0.175%
              spread; you can set an expiry in turns, and other players can fill your order early as
              a direct trade. <strong className="text-foreground">Tier 3 (direct trades)</strong>{" "}
              send a specific offer to a named character at the lowest fee. They accept or decline,
              no counter-offers, and offers expire after 24 turns by default.
            </p>
            <Callout variant="tip">
              Spread fees don&apos;t vanish into nowhere: 50% is destroyed as a deflationary sink,
              and 50% goes to the currency&apos;s central bank, which uses most of it as
              intervention ammunition. Player trading literally funds the central banks that trade
              against you.
            </Callout>
          </section>

          {/* ── 5. Wallet ── */}
          <section className="space-y-4">
            <SectionHeader id="wallet">5. The Multi-Currency Wallet</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Your character holds two money pools.{" "}
              <strong className="text-foreground">Campaign funds</strong> are always in your home
              currency. They pay for campaign spending, ads, and party actions and are never
              converted or held abroad. <strong className="text-foreground">Personal wealth</strong>{" "}
              is multi-currency: each currency is a separate balance, and foreign income lands
              directly in the matching slot.
            </p>
            <p className="text-sm text-muted leading-relaxed">
              When you make a personal purchase denominated in a foreign currency, the game spends
              your existing balance in that currency first (free, no spread), auto-converts any
              shortfall from your home currency at the market-maker rate (0.275% spread), and
              rejects the transaction if both together still fall short.
            </p>
          </section>

          {/* ── 6. Foreign income ── */}
          <section className="space-y-4">
            <SectionHeader id="foreign-income">6. Foreign Income</SectionHeader>
            <ul className="list-disc space-y-2 pl-5 text-sm text-muted leading-relaxed">
              <li>
                <strong className="text-foreground">Dividends</strong> from foreign stocks are
                auto-converted to your home currency at the market-maker rate. There is no
                per-holding preference. The conversion is automatic.
              </li>
              <li>
                <strong className="text-foreground">Bond coupons</strong> pay in the bond&apos;s
                denomination currency, deposited straight into that personal balance with no
                conversion.
              </li>
              <li>
                <strong className="text-foreground">CEO salary</strong> pays in the
                corporation&apos;s home currency, also unconverted.
              </li>
            </ul>
            <Callout variant="warn">
              Holding foreign-currency income instead of converting it is itself a position. A stack
              of yen coupons is a bet on the yen. Decide whether you want that exposure or convert
              on your own schedule.
            </Callout>
          </section>

          {/* ── 7. Strategy ── */}
          <section className="space-y-4">
            <SectionHeader id="strategy">7. Reading the Macro Board</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Because 80% of rate direction comes from fundamentals, forex trading here is mostly
              macro analysis. The questions that matter each game week:
            </p>
            <ul className="list-disc space-y-2 pl-5 text-sm text-muted leading-relaxed">
              <li>
                <strong className="text-foreground">Which central banks are moving?</strong> Rate
                hikes strengthen a currency over the following weeks; cuts weaken it. Central bank
                pages show the prime rate and recent decisions.
              </li>
              <li>
                <strong className="text-foreground">Where is inflation running hot?</strong>{" "}
                Inflation above a country&apos;s baseline drags its currency down at 1.5×&nbsp;the
                weight per point.
              </li>
              <li>
                <strong className="text-foreground">Who is growing?</strong> GDP growth above
                baseline is a steady tailwind; recessions are a steady drag.
              </li>
              <li>
                <strong className="text-foreground">What did politicians just do?</strong> Budgets,
                tariffs, and legislation move the fundamentals that move the currencies. A big
                spending bill can be a forex signal before it is a bond-market signal.
              </li>
            </ul>
            <p className="text-sm text-muted leading-relaxed">
              Cross-country investors should also remember the second-order effect: if you buy
              Japanese stock and the yen strengthens, your holding gains in home-currency terms even
              if the share price never moves. Currency appreciation and asset appreciation stack.
            </p>
          </section>

          {/* ── 8. Tips ── */}
          <section className="space-y-4">
            <SectionHeader id="tips">8. Quick Tips</SectionHeader>
            <ul className="list-disc space-y-2 pl-5 text-sm text-muted leading-relaxed">
              <li>
                Trends take ~48 turns to fully play out. You don&apos;t need to catch the exact turn
                a central bank moves, just the month it moves in.
              </li>
              <li>
                Use limit orders for planned entries and exits; the 0.1 point of spread you save
                versus the market maker compounds if you trade often.
              </li>
              <li>
                The ±5% volume-pressure cap means crowd surges fade. If a currency spikes on player
                volume with no fundamental change behind it, that spike tends to mean-revert.
              </li>
              <li>
                Keep campaign money out of your forex thinking entirely. It never leaves your home
                currency, so only personal wealth is at risk (or in play).
              </li>
              <li>
                For the full mechanics reference, see the{" "}
                <Link href="/wiki/currency-exchange" className="text-primary hover:underline">
                  Currency Exchange wiki page
                </Link>{" "}
                and the{" "}
                <Link href="/wiki/central-banks" className="text-primary hover:underline">
                  Central Banks wiki page
                </Link>
                , or start broader with the{" "}
                <Link href="/guides/investing" className="text-primary hover:underline">
                  Investing guide
                </Link>
                .
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

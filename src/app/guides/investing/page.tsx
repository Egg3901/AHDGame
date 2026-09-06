/**
 * The Investing guide page: how to invest in stocks, the currency exchange and
 * sovereign bonds, and how interest rates connect a portfolio to the wider
 * economy. Rendered by InvestingGuidePage.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { publicPageMetadata } from "@/lib/siteMetadata";

export const metadata: Metadata = publicPageMetadata({
  title: "Investing Guide | A House Divided",
  description:
    "How to invest in A House Divided: stocks, currency exchange, sovereign bonds, and how interest rates connect portfolios to the wider economy.",
  pathname: "/guides/investing",
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
  { id: "overview", label: "How Markets Work" },
  { id: "stocks", label: "Stocks & Shares" },
  { id: "share-price", label: "How Share Price Is Calculated" },
  { id: "dividends", label: "Dividends & Income" },
  { id: "forex", label: "Currency Exchange (Forex)" },
  { id: "forex-rates", label: "What Moves Exchange Rates" },
  { id: "forex-trading", label: "Forex Trading Tiers" },
  { id: "bonds", label: "Sovereign Bonds" },
  { id: "interest-rates", label: "Interest Rates" },
  { id: "strategy", label: "Putting It Together" },
];

export default function InvestingGuidePage() {
  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-10">
        {/* Breadcrumb */}
        <nav className="mb-6 flex items-center gap-1.5 text-sm text-muted">
          <Link href="/guides" className="hover:text-foreground transition-colors">
            Guides
          </Link>
          <span>/</span>
          <span className="text-foreground">Investing</span>
        </nav>

        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Investing</h1>
          <p className="mt-2 text-sm text-muted">
            Stocks, currency exchange, sovereign bonds, and how interest rates connect them all
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
            <SectionHeader id="overview">1. How Markets Work</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              A House Divided has three investable asset classes: corporate{" "}
              <strong className="text-foreground">stocks</strong>, foreign{" "}
              <strong className="text-foreground">currency</strong>, and government{" "}
              <strong className="text-foreground">bonds</strong>. Each lives in a different country
              with its own currency, and all three are interconnected through interest rates.
              Understanding how rates affect each asset is the key to investing well.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                {
                  title: "Stocks",
                  body: "Equity in player-founded corporations. Returns via dividends and price appreciation. Priced in the corporation's home currency.",
                },
                {
                  title: "Forex",
                  body: "Buy and sell national currencies (USD, GBP, JPY). Profit from rate movements driven by macro conditions.",
                },
                {
                  title: "Bonds",
                  body: "Government debt. Fixed coupon income per turn. Price moves inversely with interest rates. Buy low when rates are high.",
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
            <Callout variant="info">
              <strong className="text-foreground">Your wallet is multi-currency.</strong> Personal
              wealth can hold any currency. Campaign funds are locked to your home currency.
              Dividends, bond coupons, and CEO salaries all pay out in the source country&apos;s
              currency. Set your per-holding income preference on the stock market page to either
              keep foreign currency or auto-convert it home.
            </Callout>
          </section>

          {/* ── 2. Stocks ── */}
          <section className="space-y-4">
            <SectionHeader id="stocks">2. Stocks & Shares</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Corporations are founded by players and traded on the stock market. Each corporation
              has a CEO who controls salary, dividend payout rate, sector focus, and expansion. As
              an outside investor, you profit through dividends and share price appreciation. But
              you are always at the CEO&apos;s mercy for operational decisions.
            </p>
            <SubHeader>What to look for before buying</SubHeader>
            <ul className="space-y-2 text-sm text-muted">
              <li className="flex gap-2">
                <span className="text-primary font-bold shrink-0">→</span>
                <span>
                  <strong className="text-foreground">CEO salary.</strong> An excessive salary
                  drains liquid capital each turn, which directly depresses share price. A CEO
                  paying themselves $10M/turn on a small corporation is a red flag.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-primary font-bold shrink-0">→</span>
                <span>
                  <strong className="text-foreground">Dividend payout rate.</strong> High payout =
                  more current income; low payout = more retained earnings and higher future equity
                  per share. Neither is wrong. Decide which return profile you want.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-primary font-bold shrink-0">→</span>
                <span>
                  <strong className="text-foreground">Sector focus and expansion state.</strong>{" "}
                  Sectors outside the corporation&apos;s primary and secondary type suffer a{" "}
                  <Tag variant="negative">−15%</Tag> margin penalty. A diversified corporation with
                  no clear focus is quietly bleeding.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-primary font-bold shrink-0">→</span>
                <span>
                  <strong className="text-foreground">State economic health.</strong> Sector
                  profitability is modified by unemployment, inflation, corruption, power grid, and
                  a dozen other state-level metrics. A corporation operating in economically weak
                  states earns less.
                </span>
              </li>
            </ul>
          </section>

          {/* ── 3. Share Price ── */}
          <section className="space-y-4">
            <SectionHeader id="share-price">3. How Share Price Is Calculated</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Share price is a blended metric recalculated every turn:
            </p>
            <p className="text-sm text-muted leading-relaxed">
              In short: price blends what the corporation owns and its sector value (balance sheet),
              how much it earns (income), and recent price trend (momentum), with owned assets
              weighted most heavily. <strong className="text-foreground">NPV</strong> (net present
              value) turns each sector&apos;s future yearly profit into one lump-sum value today,
              using a <strong className="text-foreground">25% discount rate</strong>, the annual
              return investors demand before a future profit stream is worth paying for now.
            </p>
            <FormulaBlock>{`Share price = 60% balance sheet + 25% income + 15% momentum

Balance sheet:  equity per share = (liquid capital + NPV of all sectors) / total shares
  → NPV uses a 25% discount rate: yearlyProfit / 0.25
  → High CEO salary drains liquid capital → lower equity per share

Income component: based on after-tax corporate income
  → Higher dividend payout = more distributed, less retained
  → Lower retained earnings = lower future equity growth

Momentum: 15-turn price trend
  → Creates short-term trading opportunity independent of fundamentals

Floor: $0.01 per share (hard minimum)`}</FormulaBlock>
            <p className="text-sm text-muted leading-relaxed">
              The balance sheet component is the most important long-term signal. Corporations that
              retain earnings and expand into profitable states will see equity per share rise
              steadily even if their current dividends are low.
            </p>
            <Callout variant="tip">
              <strong className="text-foreground">Interest rates affect growth costs.</strong> When
              the central bank raises rates, the cost of corporate expansion rises. Corporations
              operating in high-rate environments grow more slowly, which caps the equity growth
              component of share price. This makes high-rate periods generally bad for stocks.
              exactly as in real markets.
            </Callout>
          </section>

          {/* ── 4. Dividends ── */}
          <section className="space-y-4">
            <SectionHeader id="dividends">4. Dividends & Income</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Dividends are paid every turn to all shareholders. The amount depends on the
              corporation&apos;s after-tax income and the CEO&apos;s chosen payout rate (0-100%).
              The CEO can change this rate with a 24-hour cooldown between adjustments.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-card-border bg-card p-4 space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted">
                  Income play (high payout)
                </p>
                <ul className="space-y-1 text-sm text-muted">
                  <li>• Steady dividend income each turn</li>
                  <li>• Share price grows more slowly</li>
                  <li>• Good for passive cash generation</li>
                  <li>• Paid in the corporation&apos;s home currency</li>
                </ul>
              </div>
              <div className="rounded-xl border border-card-border bg-card p-4 space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted">
                  Growth play (low payout)
                </p>
                <ul className="space-y-1 text-sm text-muted">
                  <li>• Little current income</li>
                  <li>• Retained earnings compound into equity</li>
                  <li>• Share price appreciates faster</li>
                  <li>• Sell later at higher price for capital gain</li>
                </ul>
              </div>
            </div>
            <Callout variant="warn">
              <strong className="text-foreground">The CEO controls all of this.</strong> As an
              outside investor you cannot force a payout change. If a CEO slashes dividends or
              raises their salary, your return profile changes overnight. Factor CEO behavior into
              your risk assessment.
            </Callout>
          </section>

          {/* ── 5. Forex ── */}
          <section className="space-y-4">
            <SectionHeader id="forex">5. Currency Exchange (Forex)</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Each country has its own floating currency. Exchange rates move based on macroeconomic
              fundamentals, player trading volume, and a small random noise component. You can
              speculate directly on rate movements or use the forex market simply to manage currency
              exposure from international investments.
            </p>
            <p className="text-sm text-muted leading-relaxed">
              Access the market on the{" "}
              <Link href="/market" className="text-primary hover:underline">
                stock market
              </Link>{" "}
              page under the Forex tab.
            </p>
          </section>

          {/* ── 6. What Moves Rates ── */}
          <section className="space-y-4">
            <SectionHeader id="forex-rates">6. What Moves Exchange Rates</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Rates update every turn through three components:
            </p>
            <FormulaBlock>{`Macro target = baseRate × (
  1 + (primeRate - baseline) × 0.02        // Higher rates → stronger currency
  - (inflation - baseline) × 0.015         // Higher inflation → weaker currency
  + (GDP growth - baseline) × 0.01         // Higher growth → stronger currency
  + (trade growth - baseline) × 0.005      // Trade surplus → stronger currency
)

New rate = currentRate + (macroTarget - currentRate) × 0.05  // 5% drift per turn
Volume pressure: net buy/sell from last 24 turns → ±1% effective maximum swing (raw pressure capped at 5%, applied at 20% weight)
Noise: ±0.1-0.3% per turn`}</FormulaBlock>
            <p className="text-sm text-muted leading-relaxed">
              The 5% drift speed is the key insight: major macro shocks take roughly a game year
              (~48 turns) to fully propagate. This creates persistent, exploitable trends, not
              random noise.
            </p>
            <div className="overflow-x-auto rounded-xl border border-card-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card">
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Event</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">
                      Effect on currency
                    </th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">
                      Propagation speed
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/60">
                  {[
                    [
                      "Central bank raises prime rate",
                      <Tag key="r" variant="positive">
                        Strengthens
                      </Tag>,
                      "Immediate, then drifts over weeks",
                    ],
                    [
                      "Inflation spikes",
                      <Tag key="i" variant="negative">
                        Weakens
                      </Tag>,
                      "Gradual, 12-turn monetary lag",
                    ],
                    [
                      "GDP growth accelerates",
                      <Tag key="g" variant="positive">
                        Strengthens
                      </Tag>,
                      "Slow drift",
                    ],
                    [
                      "Large sell-off by players",
                      <Tag key="s" variant="negative">
                        Weakens
                      </Tag>,
                      "Immediate, capped at −1%",
                    ],
                  ].map(([ev, eff, spd], idx) => (
                    <tr key={idx}>
                      <td className="px-4 py-2.5 text-muted">{ev}</td>
                      <td className="px-4 py-2.5">{eff}</td>
                      <td className="px-4 py-2.5 text-muted">{spd}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── 7. Forex Trading Tiers ── */}
          <section className="space-y-4">
            <SectionHeader id="forex-trading">7. Forex Trading Tiers</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Three execution methods are available, each with a different spread (cost):
            </p>
            <div className="overflow-x-auto rounded-xl border border-card-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card">
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Tier</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Spread</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Execution</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Use when</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/60">
                  {[
                    [
                      "Market Maker",
                      "0.275%",
                      "Instant, always available",
                      "You need execution now",
                    ],
                    [
                      "Public Limit Order",
                      "0.175%",
                      "Triggers when rate hits your price",
                      "You have a target rate in mind",
                    ],
                    [
                      "Direct Player Trade",
                      "0.10%",
                      "Accepted by the counterparty",
                      "Large trades, lowest cost",
                    ],
                  ].map(([t, s, e, u]) => (
                    <tr key={t}>
                      <td className="px-4 py-2.5 text-foreground font-medium">{t}</td>
                      <td className="px-4 py-2.5 text-muted font-mono">{s}</td>
                      <td className="px-4 py-2.5 text-muted">{e}</td>
                      <td className="px-4 py-2.5 text-muted">{u}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Callout variant="info">
              Your own trades contribute to volume pressure on the rate. Large market-maker buys
              push the rate up slightly (capped at +1% cumulative from player volume). This is both
              a tool and a risk. Buying into an appreciating currency accelerates the move; selling
              into a declining one worsens it.
            </Callout>
          </section>

          {/* ── 8. Bonds ── */}
          <section className="space-y-4">
            <SectionHeader id="bonds">8. Sovereign Bonds</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Governments issue bonds automatically every 12 turns (quarterly) when running a
              deficit. Each bond pays a fixed coupon, equal to the central bank&apos;s prime rate at
              issuance, every turn until maturity at turn 48. Face value is $1,000 per unit.
            </p>
            <SubHeader>
              The core dynamic: bonds and interest rates move opposite each other
            </SubHeader>
            <p className="text-sm text-muted leading-relaxed">
              When rates rise, existing bonds paying the old, lower coupon become less attractive
              and their market price falls; when rates fall, existing bonds become more attractive
              and their price rises. At maturity, price always returns to $1,000 face value
              regardless of what happened in between. See the{" "}
              <Link href="/guides/bonds#price-rate" className="text-primary hover:underline">
                Bonds guide
              </Link>{" "}
              for the full present-value formula and worked examples.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-card-border bg-card p-4 space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted">
                  Income strategy
                </p>
                <ul className="space-y-1 text-sm text-muted">
                  <li>• Hold to maturity for coupon income every turn</li>
                  <li>• Sovereign debt cannot default. Principal is guaranteed</li>
                  <li>• Coupons paid in the issuing country&apos;s currency</li>
                  <li>• Stable, predictable return</li>
                </ul>
              </div>
              <div className="rounded-xl border border-card-border bg-card p-4 space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted">
                  Capital gain strategy
                </p>
                <ul className="space-y-1 text-sm text-muted">
                  <li>• Buy when prime rates are high (bonds are cheap)</li>
                  <li>• Sell when rates fall (price appreciates)</li>
                  <li>• Watch central bank policy signals</li>
                  <li>• Carries interest rate risk if rates keep rising</li>
                </ul>
              </div>
            </div>
            <SubHeader>Credit ratings and coupon rates</SubHeader>
            <p className="text-sm text-muted leading-relaxed">
              A country&apos;s debt-to-GDP ratio determines its credit rating, which in turn
              determines the base interest rate the government pays. Higher debt means costlier
              borrowing. And bonds issued when the credit rating is poor lock in higher coupons for
              their full 48-turn life.
            </p>
            <div className="overflow-x-auto rounded-xl border border-card-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card">
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Debt-to-GDP</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Rating</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">
                      Approx. base rate
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/60">
                  {[
                    ["≤ 60%", "AAA", "2%"],
                    ["≤ 80%", "AA", "2.5%"],
                    ["≤ 100%", "A", "3.5%"],
                    ["≤ 120%", "BBB", "5%"],
                    ["≤ 150%", "BB", "7%"],
                    ["> 150%", "B", "10%"],
                  ].map(([d, r, rate]) => (
                    <tr key={d}>
                      <td className="px-4 py-2.5 text-muted">{d}</td>
                      <td className="px-4 py-2.5 text-foreground">{r}</td>
                      <td className="px-4 py-2.5 text-muted">{rate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Callout variant="tip">
              <strong className="text-foreground">
                High national debt is a buying opportunity.
              </strong>{" "}
              A government with a poor credit rating must issue bonds at high coupon rates. If you
              believe a future government will cut spending and restore fiscal health (lowering
              rates), those locked-in high-coupon bonds become extremely valuable.
            </Callout>
          </section>

          {/* ── 9. Interest Rates ── */}
          <section className="space-y-4">
            <SectionHeader id="interest-rates">9. Interest Rates</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              The central bank&apos;s prime rate is the single variable that connects all three
              asset classes. Understanding its direction is the foundation of any cross-asset
              strategy.
            </p>
            <FormulaBlock>{`When prime rate RISES:
  Bonds       → prices fall (existing bonds less attractive)
  Currency    → strengthens (higher rates attract capital)
  Stocks      → growth costs rise, expansion slows, share prices pressured
  Inflation   → falls over ~12 turns (monetary policy lag)

When prime rate FALLS:
  Bonds       → prices rise (existing bonds more attractive)
  Currency    → weakens
  Stocks      → growth costs fall, expansion cheaper, equities benefit
  Inflation   → rises over ~12 turns`}</FormulaBlock>
            <p className="text-sm text-muted leading-relaxed">
              The 12-turn inflation lag is important: rate changes don&apos;t immediately fix
              inflation. A central bank chair raising rates will not see inflation results for 12
              turns, meaning they may over-correct, creating trading opportunities when policy
              reverses.
            </p>
            <SubHeader>Baseline rates by country</SubHeader>
            <div className="overflow-x-auto rounded-xl border border-card-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card">
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Country</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">
                      Neutral prime rate
                    </th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">
                      Neutral inflation
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/60">
                  {[
                    ["United States", "2.5%", "2.0%"],
                    ["United Kingdom", "2.0%", "2.0%"],
                    ["Japan", "0.1%", "0.5%"],
                  ].map(([c, r, i]) => (
                    <tr key={c}>
                      <td className="px-4 py-2.5 text-muted">{c}</td>
                      <td className="px-4 py-2.5 text-foreground">{r}</td>
                      <td className="px-4 py-2.5 text-muted">{i}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-muted leading-relaxed">
              Rates above neutral are contractionary (slowing the economy, strengthening currency).
              Rates below neutral are expansionary (stimulating growth, weakening currency). The
              neutral rate is the equilibrium point. Deviations create the macro trends that drive
              asset prices.
            </p>
          </section>

          {/* ── 10. Strategy ── */}
          <section className="space-y-4">
            <SectionHeader id="strategy">10. Putting It Together</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              The most profitable positions are cross-asset plays that exploit the same macro signal
              from multiple angles simultaneously.
            </p>
            <SubHeader>Scenario: Central bank raises rates</SubHeader>
            <ul className="space-y-2 text-sm text-muted">
              {[
                [
                  "Sell bonds immediately.",
                  "Prices fall as the new rate makes existing coupons less competitive. Get out before the adjustment is fully priced in.",
                ],
                [
                  "Buy the currency.",
                  "Higher rates attract capital inflows; the currency strengthens over the next several turns.",
                ],
                [
                  "Be cautious on stocks.",
                  "Growth costs are rising. Corporations with heavy expansion plans or high debt will be squeezed.",
                ],
                [
                  "Wait for the lag to play out.",
                  "Inflation won't fall for 12 turns. If the central bank gets impatient and raises again, bonds get even cheaper. A better buying opportunity.",
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
            <SubHeader>Scenario: Deficit spending spikes</SubHeader>
            <ul className="space-y-2 text-sm text-muted">
              {[
                [
                  "Watch the bond issuance schedule.",
                  "More bonds hit the market quarterly. Increased supply pressures prices, especially if the credit rating has already started slipping.",
                ],
                [
                  "Consider high-coupon bonds as a long hold.",
                  "If the rating drops, new bonds are issued at higher coupon rates locked in for 48 turns. A future fiscal correction would make those bonds very valuable.",
                ],
                [
                  "Monitor inflation.",
                  "Deficit spending adds directly to inflation. Inflation weakens the currency. Position accordingly in forex.",
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
            <Callout variant="tip">
              <strong className="text-foreground">Currency exposure compounds everything.</strong> A
              US bond paying 4% coupon in USD is worth more if the USD also strengthens 3% against
              your home currency. Track the full-stack return: asset yield + currency move. The best
              trades in this game often come from correctly reading both at once.
            </Callout>
          </section>
        </div>
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { publicPageMetadata } from "@/lib/siteMetadata";
import {
  Callout,
  FormulaBlock,
  SectionHeader,
  SubHeader,
  TableOfContents,
} from "@/app/guides/_components/GuideBlocks";
import {
  DIRECT_TRADE_SPREAD,
  FOREX_MAX_TRADE_FEE,
  FOREX_SIZE_FEE_MAX,
  LIMIT_ORDER_SPREAD,
  MARKET_MAKER_SPREAD,
} from "@/lib/constants/currencies";

const pct = (rate: number) => `${(rate * 100).toFixed(2).replace(/\.?0+$/, "")}%`;

export const metadata: Metadata = publicPageMetadata({
  title: "Forex guide | A House Divided",
  description:
    "How currency exchange works in A House Divided: exchange rate mechanics, trading tiers, volume pressure, macro fundamentals, and cross-currency strategies across the US, UK, and Japan.",
  pathname: "/guides/forex",
});

const TABLE_WRAP = "overflow-x-auto rounded-lg border border-card-border";
const TABLE = "w-full min-w-[480px] text-sm";
const TH =
  "border-b border-card-border bg-card px-3 py-2 text-left text-xs font-bold uppercase tracking-wider text-muted";
const TD = "border-b border-card-border/50 px-3 py-2 text-muted";

const TOC_ITEMS = [
  { id: "overview", label: "How forex works" },
  { id: "currencies", label: "Currencies and world settings" },
  { id: "rate-movement", label: "How exchange rates move" },
  { id: "trading-tiers", label: "The three trading tiers" },
  { id: "wallet", label: "The multi-currency wallet" },
  { id: "foreign-income", label: "Foreign income" },
  { id: "strategy", label: "Reading the macro board" },
  { id: "tips", label: "Quick tips" },
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
          <span className="text-foreground">Currency exchange (forex)</span>
        </nav>

        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Currency exchange (forex)</h1>
          <p className="mt-2 text-sm text-muted">
            Exchange rate mechanics, trading tiers, volume pressure, and cross-currency strategies
          </p>
        </div>

        <div className="space-y-10">
          <TableOfContents items={TOC_ITEMS} />

          {/* ── 1. Overview ── */}
          <section className="space-y-4">
            <SectionHeader id="overview">1. How forex works</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Countries use the currencies configured for their world and era; some share a
              currency. Floating exchange rates move each turn based on economic conditions
              (interest rates, inflation, GDP growth, and trade) plus the buying and selling
              pressure of players themselves. You can trade currencies directly for profit, and
              every cross-border investment you make (foreign stocks, bonds, corporations) settles
              in the currency of the asset&apos;s country, so exchange rates flow through your whole
              portfolio whether you trade forex deliberately or not.
            </p>
            <Callout>
              Fixed exchange rates work differently. A configured peg, including a historical
              Bretton Woods peg, holds the rate steady instead of applying market drift. When
              command-economy rules are enabled, command countries also hold their official rates
              fixed. The floating-rate mechanics below apply only when neither fixed-rate rule is
              active. See{" "}
              <Link href="/guides/planned-economies" className="text-primary hover:underline">
                Planned / Command economies
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
            <SectionHeader id="currencies">2. Currencies and world settings</SectionHeader>
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
                    <td className={TD}>US dollar</td>
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
                </tbody>
              </table>
            </div>
            <p className="text-sm text-muted leading-relaxed">
              These are examples, not a complete currency roster. Available currencies and their
              names depend on the world and era. Check the exchange screen for the currencies
              available in your game and their current rates before placing a trade.
            </p>
          </section>

          {/* ── 3. Rate movement ── */}
          <section className="space-y-4">
            <SectionHeader id="rate-movement">3. How exchange rates move</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Each turn, floating rates update through three components: macro fundamental drift
              (about 80% of direction), player volume pressure (about 20%), and a little random
              noise.
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
            <Callout label="Example:">
              If the US central bank hikes the prime rate from 3.0% to 5.0%, the USD macro target
              strengthens by about 4% (2.0 points of excess × 0.02 sensitivity), and the spot rate
              grinds toward it turn after turn.
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
            <SectionHeader id="trading-tiers">4. The three trading tiers</SectionHeader>
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
                    <td className={TD}>{pct(MARKET_MAKER_SPREAD)}</td>
                    <td className={TD}>Instant, always available</td>
                  </tr>
                  <tr>
                    <td className={TD}>2</td>
                    <td className={TD}>Public limit order</td>
                    <td className={TD}>{pct(LIMIT_ORDER_SPREAD)}</td>
                    <td className={TD}>When the market crosses your limit</td>
                  </tr>
                  <tr>
                    <td className={TD}>3</td>
                    <td className={TD}>Direct player trade</td>
                    <td className={TD}>{pct(DIRECT_TRADE_SPREAD)}</td>
                    <td className={TD}>When the target player accepts</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-sm text-muted leading-relaxed">
              <strong className="text-foreground">Tier 1 (market maker)</strong> fills instantly at
              the current rate plus a {pct(MARKET_MAKER_SPREAD)} base fee. It is also what
              auto-convert uses when you buy a foreign asset without holding that currency.{" "}
              <strong className="text-foreground">Tier 2 (limit orders)</strong> post publicly at
              your target rate and auto-fill when the market crosses it, for a cheaper{" "}
              {pct(LIMIT_ORDER_SPREAD)} base fee; you can set an expiry in turns, and other players
              can fill your order early as a direct trade.{" "}
              <strong className="text-foreground">Tier 3 (direct trades)</strong> send a specific
              offer to a named character at the lowest fee. They accept or decline, no
              counter-offers, and offers expire after 24 turns by default.
            </p>
            <p className="text-sm text-muted leading-relaxed">
              Your own market and limit trades also pay a size fee that rises toward{" "}
              {pct(FOREX_SIZE_FEE_MAX)} on very large conversions. It counts everything you
              converted in the last 24 turns, so splitting a big trade into small ones costs the
              same. The whole fee is then scaled by how busy the two currencies are: half price in a
              busy market, up to one and a half times in a quiet one, and never more than{" "}
              {pct(FOREX_MAX_TRADE_FEE)} in total. Auto-convert pays only the base fee.
            </p>
            <Callout>
              Spread fees don&apos;t vanish into nowhere: 50% is destroyed as a deflationary sink,
              and 50% goes to the currency&apos;s central bank, which uses most of it as
              intervention ammunition. Player trading literally funds the central banks that trade
              against you.
            </Callout>
          </section>

          {/* ── 5. Wallet ── */}
          <section className="space-y-4">
            <SectionHeader id="wallet">5. The multi-currency wallet</SectionHeader>
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
              shortfall from your home currency at the market-maker rate ({pct(MARKET_MAKER_SPREAD)}{" "}
              fee), and rejects the transaction if both together still fall short.
            </p>
          </section>

          {/* ── 6. Foreign income ── */}
          <section className="space-y-4">
            <SectionHeader id="foreign-income">6. Foreign income</SectionHeader>
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
            <Callout>
              Holding foreign-currency income instead of converting it is itself a position. A stack
              of yen coupons is a bet on the yen. Decide whether you want that exposure or convert
              on your own schedule.
            </Callout>
          </section>

          {/* ── 7. Strategy ── */}
          <section className="space-y-4">
            <SectionHeader id="strategy">7. Reading the macro board</SectionHeader>
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
            <SectionHeader id="tips">8. Quick tips</SectionHeader>
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

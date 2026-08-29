import type { Metadata } from "next";
import Link from "next/link";
import { publicPageMetadata } from "@/lib/siteMetadata";

export const metadata: Metadata = publicPageMetadata({
  title: "Bonds Guide | A House Divided",
  description:
    "How bonds work in A House Divided: face value, coupons, maturity, the price and rate relationship, sovereign vs corporate bonds, credit ratings, and defaults.",
  pathname: "/guides/bonds",
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
  { id: "what-is-a-bond", label: "What Is a Bond?" },
  { id: "sovereign-bonds", label: "Sovereign Bonds" },
  { id: "corporate-bonds", label: "Corporate Bonds" },
  { id: "price-rate", label: "The Price/Rate Relationship" },
  { id: "sovereign-ratings", label: "Sovereign Credit Ratings" },
  { id: "corporate-ratings", label: "Corporate Credit Ratings" },
  { id: "defaults", label: "Defaults & Recovery" },
  { id: "buying-bonds", label: "How to Evaluate a Bond" },
  { id: "tips", label: "Quick Tips" },
];

export default function BondsGuidePage() {
  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-10">
        {/* Breadcrumb */}
        <nav className="mb-6 flex items-center gap-1.5 text-sm text-muted">
          <Link href="/guides" className="hover:text-foreground transition-colors">
            Guides
          </Link>
          <span>/</span>
          <span className="text-foreground">Bonds</span>
        </nav>

        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Bonds</h1>
          <p className="mt-2 text-sm text-muted">
            How bonds work - from the basics through credit ratings, defaults, and strategy
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

          {/* ── 1. What Is a Bond ── */}
          <section className="space-y-4">
            <SectionHeader id="what-is-a-bond">1. What Is a Bond?</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              A bond is a loan. You lend money to a government or corporation; in return they pay
              you a fixed interest rate (the <strong className="text-foreground">coupon</strong>)
              every turn until the bond matures, at which point they return your original principal.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                {
                  term: "Face Value",
                  def: "The principal amount - $1,000 per bond unit. This is what you receive back at maturity.",
                },
                {
                  term: "Coupon",
                  def: "The fixed interest rate set at issuance. Paid to you every turn as income, regardless of market price.",
                },
                {
                  term: "Maturity",
                  def: "When the bond expires. Sovereign bonds last 48 turns (1 game year). Corporate bond terms vary.",
                },
              ].map(({ term, def }) => (
                <div
                  key={term}
                  className="rounded-xl border border-card-border bg-card p-4 space-y-1.5"
                >
                  <p className="text-xs font-bold uppercase tracking-wider text-muted">{term}</p>
                  <p className="text-sm text-muted leading-relaxed">{def}</p>
                </div>
              ))}
            </div>
            <Callout variant="info">
              <strong className="text-foreground">
                Coupon income vs. market price are separate.
              </strong>{" "}
              Your coupon payment never changes - it is locked in at issuance. What changes is what
              someone would pay you if you wanted to sell the bond early. These two values move
              independently of each other.
            </Callout>
          </section>

          {/* ── 2. Sovereign Bonds ── */}
          <section className="space-y-4">
            <SectionHeader id="sovereign-bonds">2. Sovereign Bonds</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Sovereign bonds are issued by national governments to finance their budget deficit.
              They are the safest bonds in the game - governments cannot default.
            </p>
            <SubHeader>How they are issued</SubHeader>
            <p className="text-sm text-muted leading-relaxed">
              New bonds are issued automatically every{" "}
              <strong className="text-foreground">12 turns (quarterly)</strong> when a country is
              running a deficit. The issuance amount equals one quarter of the annual deficit. If
              the budget is in surplus, no new bonds are issued that quarter.
            </p>
            <div className="overflow-x-auto rounded-xl border border-card-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card">
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Property</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/60">
                  {[
                    ["Face value", "$1,000 per unit"],
                    ["Coupon rate", "Equal to the country's central bank prime rate at issuance"],
                    ["Maturity", "48 turns (1 game year)"],
                    ["Default risk", "None - sovereign bonds are guaranteed"],
                    ["Issuance schedule", "Quarterly (every 12 turns), only when deficit > 0"],
                  ].map(([p, v]) => (
                    <tr key={p}>
                      <td className="px-4 py-2.5 text-muted">{p}</td>
                      <td className="px-4 py-2.5 text-foreground">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <SubHeader>What the coupon pays you</SubHeader>
            <p className="text-sm text-muted leading-relaxed">
              A bond issued when the prime rate is 5% pays a 5% annual coupon - that is{" "}
              <strong className="text-foreground">$50 per year per $1,000 bond</strong>, paid
              proportionally each turn. The coupon is fixed at issuance and never changes for the
              life of that bond, even if the prime rate moves later.
            </p>
            <Callout variant="tip">
              <strong className="text-foreground">No credit risk, but currency risk exists.</strong>{" "}
              Sovereign bonds pay out in the issuing country&apos;s currency. A US bond pays USD, a
              UK bond pays GBP, a Japan bond pays JPY. If your home currency strengthens against the
              issuing country&apos;s currency while you hold the bond, your effective return falls -
              and vice versa.
            </Callout>
          </section>

          {/* ── 3. Corporate Bonds ── */}
          <section className="space-y-4">
            <SectionHeader id="corporate-bonds">3. Corporate Bonds</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Corporate bonds are issued by player-founded corporations to raise capital. They work
              the same as sovereign bonds - fixed coupon, fixed maturity, tradeable on the market -
              but they carry <strong className="text-foreground">default risk</strong>. A
              corporation that runs out of cash cannot pay its bondholders.
            </p>
            <SubHeader>How the coupon is set</SubHeader>
            <p className="text-sm text-muted leading-relaxed">
              Corporate bond coupons are{" "}
              <strong className="text-foreground">
                prime rate + rating-tier spread + a fixed corporate issuance premium
              </strong>
              . The tier spread depends on the corporation&apos;s credit rating at issuance;
              better-rated companies borrow cheaper. The extra premium applies to all new corporate
              issues equally (sovereign/treasury bonds do not use it).
            </p>
            <div className="overflow-x-auto rounded-xl border border-card-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card">
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Rating</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">
                      Total spread vs. prime (tier + 1.0%)
                    </th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">
                      Example coupon (at 5% prime)
                    </th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Risk</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/60">
                  {[
                    ["AAA", "+1.0%", "6.0%", "Very low"],
                    ["AA", "+1.5%", "6.5%", "Low"],
                    ["A", "+2.5%", "7.5%", "Moderate"],
                    ["BBB", "+4.0%", "9.0%", "Medium"],
                    [
                      "BB",
                      "+6.0%",
                      "11.0%",
                      <Tag key="bb" variant="negative">
                        Speculative
                      </Tag>,
                    ],
                    [
                      "B",
                      "+9.0%",
                      "14.0%",
                      <Tag key="b" variant="negative">
                        Very high
                      </Tag>,
                    ],
                    [
                      "CCC",
                      "+13.0%",
                      "18.0%",
                      <Tag key="ccc" variant="negative">
                        Distressed
                      </Tag>,
                    ],
                  ].map(([r, s, e, ri]) => (
                    <tr key={r as string}>
                      <td className="px-4 py-2.5 text-foreground font-mono font-semibold">{r}</td>
                      <td className="px-4 py-2.5 text-muted">{s}</td>
                      <td className="px-4 py-2.5 text-muted">{e}</td>
                      <td className="px-4 py-2.5 text-muted">{ri}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <SubHeader>Maturity choices</SubHeader>
            <p className="text-sm text-muted leading-relaxed">
              New corporate bonds must mature in{" "}
              <strong className="text-foreground">2, 5, or 7</strong> game years (96, 240, or 336
              turns). Bonds issued earlier at shorter maturities remain on the books until they
              mature.
            </p>
            <Callout variant="warn">
              <strong className="text-foreground">Issuing is borrowing, not income.</strong> The
              corporation receives the whole face value in cash on the turn it issues, pays the
              coupon every turn after that, and then repays the whole face value in one payment on
              the maturity turn. Nothing amortizes along the way, so the cash has to be there on
              that turn. Every unit issued is charged for, including units still sitting on the
              public float that nobody bought.
            </Callout>
            <Callout variant="warn">
              <strong className="text-foreground">The coupon locks at issuance.</strong> If a
              company issues a BBB bond today and later falls to CCC, the coupon rate on that
              existing bond does not change - but the market price will fall to compensate for the
              increased risk. New bonds issued after the downgrade will carry the higher CCC spread.
            </Callout>
          </section>

          {/* ── 4. Price / Rate Relationship ── */}
          <section className="space-y-4">
            <SectionHeader id="price-rate">4. The Price/Rate Relationship</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              This is the most important mechanic to understand. Bond market prices and interest
              rates always move in <strong className="text-foreground">opposite directions</strong>.
            </p>
            <p className="text-sm text-muted leading-relaxed">
              Here is why: imagine you hold a bond paying $50/year (5% coupon on a $1,000 bond). The
              central bank then raises rates to 8%. New bonds now pay $80/year. Nobody would pay
              $1,000 for your bond paying $50 when they can get $80 from a new one. The price of
              your bond must fall until the yield is competitive.
            </p>
            <p className="text-sm text-muted leading-relaxed">
              In short: a bond&apos;s market price is the present value of every remaining coupon
              payment plus the final payoff, discounted at today&apos;s interest rate. A higher rate
              makes those future dollars worth less right now, so price falls; a lower rate makes
              them worth more, so price rises.
            </p>
            <FormulaBlock>{`Bond market price = C × [(1 − (1+r)^−n) / r] + (1+r)^−n × $1,000

Where:
  C = annual coupon payment (couponRate% × $1,000, divided by 48 for per-turn)
  r = current yield rate (prime for sovereign, prime + tier spread + corporate premium for corporates)
  n = years remaining to maturity (turnsRemaining / 48)

Key insight: prices and rates still move in opposite directions.
When rates rise, existing bonds lose value. When rates fall, they gain.
As maturity approaches, price always pulls back toward $1,000 (face value).

Example - sovereign bond, coupon locked at 5%, 1 year remaining:
  Prime rate rises to 8%:   price ≈ $972   (modest loss - near maturity)
  Prime rate falls to 2.5%: price ≈ $1,024  (modest gain - near maturity)

The further from maturity, the bigger the price swing for the same rate change.`}</FormulaBlock>
            <div className="overflow-x-auto rounded-xl border border-card-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card">
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">
                      Rate environment
                    </th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">
                      Effect on bond prices
                    </th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Strategy</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/60">
                  {[
                    [
                      "Rates rising",
                      <Tag key="r" variant="negative">
                        Prices fall
                      </Tag>,
                      "Wait. Buy when rates peak - you lock in high coupons before cuts begin.",
                    ],
                    [
                      "Rates at peak",
                      "Prices at floor",
                      "Buy now. Future cuts will push prices up while you collect the high coupon.",
                    ],
                    [
                      "Rates falling",
                      <Tag key="f" variant="positive">
                        Prices rise
                      </Tag>,
                      "Hold for capital gain. Sell before rates bottom out.",
                    ],
                    [
                      "Rates at floor",
                      "Prices at ceiling",
                      "Avoid buying. Any rate rise will compress prices. Seek higher-yield alternatives.",
                    ],
                  ].map(([env, eff, strat], idx) => (
                    <tr key={idx}>
                      <td className="px-4 py-2.5 text-muted">{env}</td>
                      <td className="px-4 py-2.5">{eff}</td>
                      <td className="px-4 py-2.5 text-muted">{strat}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Callout variant="info">
              <strong className="text-foreground">
                Holding to maturity removes price risk entirely.
              </strong>{" "}
              If you buy a bond and hold it until it matures, you always receive exactly face value
              ($1,000) back, regardless of what the market price did in between. Price volatility
              only matters if you plan to sell early.
            </Callout>
          </section>

          {/* ── 5. Sovereign Ratings ── */}
          <section className="space-y-4">
            <SectionHeader id="sovereign-ratings">5. Sovereign Credit Ratings</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Sovereign bonds are guaranteed against default, but the country&apos;s
              <strong className="text-foreground"> credit rating</strong> still matters - it
              determines the interest rate at which the government borrows, which sets the coupon
              rate on new bonds. Higher debt relative to GDP means more expensive borrowing.
            </p>
            <div className="overflow-x-auto rounded-xl border border-card-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card">
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Debt-to-GDP</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Rating</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">
                      Approx. base borrowing rate
                    </th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">
                      What this means for bonds
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/60">
                  {[
                    ["≤ 60%", "AAA", "2%", "Low coupons, but safest value store"],
                    ["≤ 80%", "AA", "2.5%", "Near-best; minimal premium"],
                    ["≤ 100%", "A", "3.5%", "Solid - most healthy economies sit here"],
                    ["≤ 120%", "BBB", "5%", "Notable risk premium; decent income"],
                    ["≤ 150%", "BB", "7%", "Elevated risk; high coupons but fiscal strain"],
                    ["> 150%", "B", "10%", "Distressed; very high coupons but severe fiscal risk"],
                  ].map(([d, r, rate, note]) => (
                    <tr key={d}>
                      <td className="px-4 py-2.5 text-muted">{d}</td>
                      <td className="px-4 py-2.5 text-foreground font-mono font-semibold">{r}</td>
                      <td className="px-4 py-2.5 text-muted">{rate}</td>
                      <td className="px-4 py-2.5 text-muted">{note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Callout variant="tip">
              <strong className="text-foreground">Fiscal deterioration is a buying signal.</strong>{" "}
              When a country&apos;s debt-to-GDP is rising, new bonds are issued at higher coupon
              rates. If you believe a future government will restore fiscal discipline (cutting
              rates), buying those high-coupon bonds early means you lock in premium income that
              persists for the full 48-turn life of the bond.
            </Callout>
          </section>

          {/* ── 6. Corporate Ratings ── */}
          <section className="space-y-4">
            <SectionHeader id="corporate-ratings">6. Corporate Credit Ratings</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Corporate credit ratings are calculated from four financial components. The score
              updates every turn, so a corporation&apos;s rating can improve or deteriorate over
              time - and so can the market price of its bonds.
            </p>
            <div className="overflow-x-auto rounded-xl border border-card-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card">
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Component</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Weight</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">
                      What it measures
                    </th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Red flag</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/60">
                  {[
                    [
                      "Debt-to-Equity",
                      "30%",
                      "Is the company overleveraged?",
                      "D/E ratio rising above 1.5×",
                    ],
                    [
                      "Interest Coverage",
                      "25%",
                      "Can it pay interest from earnings?",
                      "Earnings below interest costs",
                    ],
                    [
                      "Profitability",
                      "25%",
                      "Is it actually making money?",
                      "Sustained losses or negative ROE",
                    ],
                    [
                      "Liquidity",
                      "20%",
                      "Does it have cash on hand?",
                      "Cash falling below 1 turn of interest",
                    ],
                  ].map(([c, w, m, r]) => (
                    <tr key={c}>
                      <td className="px-4 py-2.5 text-foreground font-medium">{c}</td>
                      <td className="px-4 py-2.5 text-muted font-mono">{w}</td>
                      <td className="px-4 py-2.5 text-muted">{m}</td>
                      <td className="px-4 py-2.5 text-muted">{r}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-muted leading-relaxed">
              Scores are smoothed using a{" "}
              <strong className="text-foreground">75% new / 25% previous</strong> blend to prevent
              wild single-turn swings. A company cannot jump from AAA to CCC in one turn, but
              sustained losses will steadily drag a rating down.
            </p>
            <Callout variant="warn">
              <strong className="text-foreground">
                Corporate bonds have two risk levers sovereign bonds do not: credit risk and CEO
                risk.
              </strong>{" "}
              A CEO can raise their salary, slash dividends, or take on more debt - all of which can
              deteriorate the credit rating. Before buying a corporate bond, assess the CEO&apos;s
              track record, not just the current snapshot.
            </Callout>
          </section>

          {/* ── 7. Defaults ── */}
          <section className="space-y-4">
            <SectionHeader id="defaults">7. Defaults &amp; Recovery</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              A corporate bond defaults when the corporation&apos;s{" "}
              <strong className="text-foreground">cash (liquid capital) goes negative</strong> after
              paying its coupon obligations{" "}
              <strong className="text-foreground">and any face value falling due that turn</strong>,
              and its assets could not cover the debt. This is the only trigger - a company can have
              a bad credit rating without defaulting as long as it can still make payments. Maturity
              is the dangerous one: the coupon is a trickle, and the face value lands in a single
              turn.
            </p>
            <SubHeader>What happens on default</SubHeader>
            <ul className="space-y-2 text-sm text-muted">
              <li className="flex gap-2">
                <span className="text-red-400 font-bold shrink-0">1.</span>
                <span>
                  The bond is immediately marked as{" "}
                  <strong className="text-foreground">defaulted</strong>.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-red-400 font-bold shrink-0">2.</span>
                <span>
                  The market price locks at{" "}
                  <strong className="text-foreground">$0.10 on the dollar</strong> - a 90% haircut.
                  Holders who want out take a near-total loss.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-red-400 font-bold shrink-0">3.</span>
                <span>
                  The corporation&apos;s credit score is capped at the CCC floor for{" "}
                  <strong className="text-foreground">96 turns</strong>. It cannot issue new bonds
                  at good rates during this window.
                </span>
              </li>
            </ul>
            <SubHeader>CEO recovery option: refinance</SubHeader>
            <p className="text-sm text-muted leading-relaxed">
              Instead of dissolving, the CEO can refinance defaulted debt. Existing holders roll
              into a new bond at par (units preserved, full face-value claim restored), and the old
              defaulted paper is retired. This is a debt-for-debt swap. The corporation does not
              receive any new cash, because no new investors are buying the issuance. The benefit is
              that holders get off the $0.10 locked price and the corporation clears the default,
              though the new bond carries the current CCC-floored coupon so debt service gets more
              expensive. Refinancing is capped at{" "}
              <strong className="text-foreground">2 times per corporation lifetime</strong>. After
              that, dissolution is the only option for the remaining defaulted debt. Still subject
              to the 2× equity debt cap.
            </p>
            <SubHeader>If the corporation dissolves</SubHeader>
            <p className="text-sm text-muted leading-relaxed">
              Bondholders have priority over shareholders in dissolution. Assets are liquidated and
              distributed:
            </p>
            <div className="overflow-x-auto rounded-xl border border-card-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card">
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Scenario</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">
                      Bond recovery
                    </th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">
                      Shareholder recovery
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/60">
                  {[
                    [
                      "Assets ≥ bond claims",
                      "100% ($1,000/unit)",
                      "Remaining assets split pro-rata",
                    ],
                    ["Assets = bond claims exactly", "100% ($1,000/unit)", "$0"],
                    ["Assets < bond claims", "Pro-rata share of assets (partial)", "$0"],
                  ].map(([s, b, sh]) => (
                    <tr key={s}>
                      <td className="px-4 py-2.5 text-muted">{s}</td>
                      <td className="px-4 py-2.5 text-foreground">{b}</td>
                      <td className="px-4 py-2.5 text-muted">{sh}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Callout variant="tip">
              <strong className="text-foreground">
                Defaulted bonds at $0.10 can be a speculative bet.
              </strong>{" "}
              If you believe a corporation will recover - new CEO, better margins, reduced debt -
              buying defaulted bonds at 10 cents on the dollar means a 10× return on principal
              recovery. High risk, high reward.
            </Callout>
          </section>

          {/* ── 8. How to Evaluate a Bond ── */}
          <section className="space-y-4">
            <SectionHeader id="buying-bonds">8. How to Evaluate a Bond</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              The questions to ask before buying, in order:
            </p>
            <ul className="space-y-3 text-sm text-muted">
              {[
                [
                  "What is the coupon relative to the current effective rate?",
                  "For sovereign bonds, compare the coupon to the prime rate. For corporate bonds, compare it to prime + the rating-tier spread + 1.0 percentage-point corporate premium (e.g. at AAA: prime + 1% total spread vs. prime). If the coupon exceeds the current effective rate, the bond trades at a premium; if it's lower, it trades at a discount.",
                ],
                [
                  "Where are rates headed?",
                  "Rising rates = falling bond prices. Falling rates = rising bond prices. Time your entry around the rate cycle, not current yield alone.",
                ],
                [
                  "For corporate bonds: what is the credit rating trend?",
                  "A BBB company improving toward A will see its bond prices rise (spread narrows). A BBB company deteriorating toward BB will see prices fall. The direction matters as much as the current level.",
                ],
                [
                  "What is your exit strategy?",
                  "For sovereign bonds, holding to maturity guarantees you get $1,000/unit back, with no default risk. For corporate bonds, maturity only pays par if the company doesn't default in the meantime; a default locks the market price at $0.10/unit and recovery depends on dissolution or refinance. Selling early means accepting whatever the market offers.",
                ],
                [
                  "For corporate bonds: can the company make its payments?",
                  "Check liquidity (cash on hand relative to interest obligations). A company with thin cash and a high coupon burden is a default waiting to happen.",
                ],
              ].map(([q, a]) => (
                <li
                  key={q as string}
                  className="flex gap-3 rounded-xl border border-card-border bg-card p-4"
                >
                  <span className="text-primary font-bold shrink-0 mt-0.5">→</span>
                  <span>
                    <strong className="text-foreground">{q}</strong> {a}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* ── 9. Quick Tips ── */}
          <section className="space-y-4">
            <SectionHeader id="tips">9. Quick Tips</SectionHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                [
                  "Buy near the rate peak.",
                  "You lock in a high coupon, and any future rate cut pushes the price up.",
                ],
                [
                  "Sell near the rate floor.",
                  "The bond price is close to its ceiling by then, so most of the upside is already gone.",
                ],
                [
                  "Sovereign bonds are for steady income.",
                  "No default risk, guaranteed maturity payout. A baseline income layer that doesn't need monitoring.",
                ],
                [
                  "Corporate bonds need active management.",
                  "Higher yields, but you have to watch the company. A single bad quarter can crack a BBB rating and compress bond prices.",
                ],
                [
                  "Holding to maturity removes price risk.",
                  "If you don't need the liquidity, just hold. Market noise stops mattering.",
                ],
                [
                  "Currency exposure stacks on top of rate exposure.",
                  "A foreign bond gives you both interest rate exposure and currency exposure. A strengthening USD and a weakening JPY together could wipe out a JPY bond's income advantage.",
                ],
              ].map(([title, body]) => (
                <div
                  key={title}
                  className="rounded-xl border border-card-border bg-card p-4 space-y-1.5"
                >
                  <p className="text-xs font-bold uppercase tracking-wider text-muted">{title}</p>
                  <p className="text-sm text-muted leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

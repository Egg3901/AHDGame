import type { Metadata } from "next";
import Link from "next/link";
import { publicPageMetadata } from "@/lib/siteMetadata";

export const metadata: Metadata = publicPageMetadata({
  title: "Planned / Command Economies Guide | A House Divided",
  description:
    "How to play a planned economy in A House Divided: run state enterprises, hold the SOE Director / Gosplan / Gosbank seats, direct state credit and pay its shortage cost, and earn or lose marketization through black market, plan performance, and policy.",
  pathname: "/guides/planned-economies",
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
  { id: "overview", label: "What This Is" },
  { id: "how-it-starts", label: "How a Country Becomes One" },
  { id: "soes", label: "State-Owned Enterprises" },
  { id: "seats", label: "The Three Seats" },
  { id: "credit", label: "Directed Credit and Its Cost" },
  { id: "marketization", label: "Marketization Is Earned" },
  { id: "loops", label: "The Feedback Loops" },
  { id: "repression", label: "Repression: Holding the Line" },
  { id: "planned-rules", label: "The Planned Rules Still Apply" },
  { id: "dual-track", label: "Dual-Track Transition" },
  { id: "what-to-do", label: "What You Can Do" },
];

export default function PlannedEconomiesGuidePage() {
  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-10">
        {/* Breadcrumb */}
        <nav className="mb-6 flex items-center gap-1.5 text-sm text-muted">
          <Link href="/guides" className="hover:text-foreground transition-colors">
            Guides
          </Link>
          <span>/</span>
          <span className="text-foreground">Planned / Command Economies</span>
        </nav>

        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Planned / Command Economies</h1>
          <p className="mt-2 text-sm text-muted">
            Run the state industries, allocate the plan, direct state credit, and decide whether the
            country stays communist or reforms toward the market
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
            <SectionHeader id="overview">1. What This Is</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Most countries in A House Divided are market economies: floating currencies, a
              central-bank chair setting rates, commodity prices that clear on supply and demand.
              Planned (command) economies are a different model, and now a played one. In a command
              country you run the state industries, set the national plan, and direct state credit.
              Whether the country stays communist or reforms toward the market is{" "}
              <strong className="text-foreground">decided by how well the plan is run</strong>, not
              by a script.
            </p>
            <Callout variant="warn">
              <strong className="text-foreground">This is not a bug.</strong> If a Soviet-era ruble
              never drifts, national commodity prices ignore S/D, or a state firm stays alive while
              insolvent, you are looking at planned-economy rules. The market guides (
              <Link href="/guides/commodities" className="text-primary hover:underline">
                Commodities
              </Link>
              ,{" "}
              <Link href="/guides/forex" className="text-primary hover:underline">
                Forex
              </Link>
              ) describe the market path. This page describes the planned path.
            </Callout>
            <p className="text-sm text-muted leading-relaxed">
              The regime is off by default. When an admin enables{" "}
              <strong className="text-foreground">command economy</strong>, countries that start on
              the command end of the dial (USSR/Russia, China in its early eras, Eastern-bloc
              satellites) come up as planned economies with their state industries split into
              separate enterprises you can run.
            </p>
          </section>

          {/* ── 2. How it starts ── */}
          <section className="space-y-4">
            <SectionHeader id="how-it-starts">2. How a Country Becomes One</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">Two gates must both be true:</p>
            <ol className="list-decimal space-y-2 pl-5 text-sm text-muted leading-relaxed">
              <li>
                An <strong className="text-foreground">admin</strong> turns on the command-economy
                feature for the world (default off). Players cannot flip this themselves.
              </li>
              <li>
                The country&apos;s <strong className="text-foreground">marketization level</strong>{" "}
                is below the market ceiling. The era only sets the{" "}
                <strong className="text-foreground">starting</strong> value. From there the level
                moves on its own each turn based on what happens in the economy.
              </li>
            </ol>
            <div className="overflow-x-auto rounded-xl border border-card-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card">
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Band</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">Dial</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted">What you get</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/60">
                  <tr>
                    <td className="px-4 py-2.5 text-foreground font-medium">Fully command</td>
                    <td className="px-4 py-2.5 text-muted font-mono">below 30</td>
                    <td className="px-4 py-2.5 text-muted">
                      Fixed currency, passive bank, administered CPI, soft budgets, full planned
                      pricing
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 text-foreground font-medium">Dual-track</td>
                    <td className="px-4 py-2.5 text-muted font-mono">30 to under 70</td>
                    <td className="px-4 py-2.5 text-muted">
                      Plan and market run together; national prices and shortage pressure scale with
                      how much is still planned
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2.5 text-foreground font-medium">Market</td>
                    <td className="px-4 py-2.5 text-muted font-mono">70+</td>
                    <td className="px-4 py-2.5 text-muted">
                      Standard floating FX, chair policy, S/D commodity pricing
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-sm text-muted leading-relaxed">
              Soviet Russia and early China start fully command; Eastern-bloc countries start
              command; China starts further along the dial in later eras. Where each ends up is now
              up to how the country is governed.
            </p>
          </section>

          {/* ── 3. SOEs ── */}
          <section className="space-y-4">
            <SectionHeader id="soes">3. State-Owned Enterprises</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Instead of one national conglomerate, a command country&apos;s commanding heights are
              split into{" "}
              <strong className="text-foreground">
                separate state enterprises, one per strategic sector
              </strong>{" "}
              (heavy industry, energy, extraction, agriculture, consumer goods, defense, chemicals,
              transport; the exact set is country and era specific). Each SOE carries its own:
            </p>
            <ul className="list-disc space-y-2 pl-5 text-sm text-muted leading-relaxed">
              <li>
                <strong className="text-foreground">Plan target</strong>: the output quota it is
                expected to hit.
              </li>
              <li>
                <strong className="text-foreground">Output</strong>: what it actually produced this
                turn.
              </li>
              <li>
                <strong className="text-foreground">Plan fulfillment</strong>: output divided by
                target. This is the score the enterprise is judged on.
              </li>
              <li>
                <strong className="text-foreground">Capacity and efficiency</strong>: how much it
                could produce and how well it uses what it has.
              </li>
              <li>
                <strong className="text-foreground">Cumulative losses</strong>: the running tally of
                missed plan (the soft-budget bill).
              </li>
            </ul>
            <Callout variant="tip">
              When lots of SOEs beat their targets, the plan is working and the command model holds.
              When they chronically miss, shortages build and pressure to reform the whole system
              grows.
            </Callout>
          </section>

          {/* ── 4. Three seats ── */}
          <section className="space-y-4">
            <SectionHeader id="seats">4. The Three Seats</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              A command economy is run through three offices. Each is filled by the government
              (cabinet or Supreme Soviet). If a seat is empty, the state brain runs it competently
              by default, so single-player worlds still work. A human who claims a seat takes over
              from the brain.
            </p>
            <div className="space-y-4">
              <div className="rounded-xl border border-card-border bg-card p-4 space-y-2">
                <SubHeader>SOE Director (the industrialist)</SubHeader>
                <p className="text-sm text-muted leading-relaxed">
                  One director seat per strategic SOE. The director runs a single enterprise and
                  chooses its <strong className="text-foreground">production target</strong> (safe
                  or a stretch quota), files an{" "}
                  <strong className="text-foreground">investment request</strong> to the Gosbank
                  Chair for capital, and sets the{" "}
                  <strong className="text-foreground">labor-versus-quality</strong> mix (raw output
                  now, or efficiency and quality for later). Hit your targets and the enterprise
                  grows and your standing rises; miss them and you feed the shortages that erode the
                  command system.
                </p>
              </div>
              <div className="rounded-xl border border-card-border bg-card p-4 space-y-2">
                <SubHeader>Gosplan Central Planner (the macro)</SubHeader>
                <p className="text-sm text-muted leading-relaxed">
                  The planner sets the <strong className="text-foreground">national plan</strong>:
                  the output quotas and the investment split across every sector. This is the
                  heavy-industry-versus-consumer-goods balancing act. Over-ambitious targets look
                  strong on paper but widen the gap between plan and reality, which shows up as
                  shortage. Under-ambitious targets leave growth on the table.
                </p>
              </div>
              <div className="rounded-xl border border-card-border bg-card p-4 space-y-2">
                <SubHeader>Gosbank Chair (the kingmaker)</SubHeader>
                <p className="text-sm text-muted leading-relaxed">
                  The Gosbank Chair runs <strong className="text-foreground">state credit</strong>.
                  Each turn the bank lends a credit budget across the SOEs. The chair decides{" "}
                  <strong className="text-foreground">which sectors get the money</strong> (an
                  explicit per-sector allocation, or let the bank steer credit to the enterprises
                  missing plan),{" "}
                  <strong className="text-foreground">how aggressively to fund</strong> (restrained
                  or a flood), and <strong className="text-foreground">budget softness</strong>{" "}
                  (bail out insolvent SOEs and keep them running, or let the weak ones fold to force
                  efficiency).
                </p>
              </div>
            </div>
          </section>

          {/* ── 5. Directed credit ── */}
          <section className="space-y-4">
            <SectionHeader id="credit">5. Directed Credit and Its Cost</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Directed credit is the Gosbank Chair&apos;s main lever, and it is a genuine tradeoff.
            </p>
            <ul className="list-disc space-y-2 pl-5 text-sm text-muted leading-relaxed">
              <li>
                <strong className="text-foreground">The upside</strong>: credit builds an SOE&apos;s
                capacity and lifts its output over the following turns. Fund the right sectors and
                you hit the plan and hold the economy together.
              </li>
              <li>
                <strong className="text-foreground">The cost</strong>: the part of that credit not
                backed by real household savings is printed money. It piles up as monetary overhang,
                which drives shortage. Fund everyone generously and you empty the shelves.
              </li>
            </ul>
            <Callout variant="warn">
              <strong className="text-foreground">The Gosbank tightrope:</strong> you can grow
              industry with cheap credit, but the more you print the worse the shortages get, and
              shortages are one of the forces that push the country toward the market. You have to
              choose favorites.
            </Callout>
          </section>

          {/* ── 6. Marketization earned ── */}
          <section className="space-y-4">
            <SectionHeader id="marketization">6. Marketization Is Earned</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              The single most important change: marketization is{" "}
              <strong className="text-foreground">no longer scripted</strong>. The era sets the
              starting level, then it drifts every turn based on three live drivers.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                {
                  term: "Black-market pressure",
                  def: "Pushes toward market when shortages, the shadow premium (how much more black-market goods cost than the official price), and the second economy are large.",
                },
                {
                  term: "SOE performance",
                  def: "Pushes toward market when the state enterprises are chronically missing their plan.",
                },
                {
                  term: "Policy stance",
                  def: "Pushes toward market when the elected government and the Gosbank lean reformist: a market-leaning ruling party, disciplined credit, hard budgets.",
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
            <p className="text-sm text-muted leading-relaxed">
              There is <strong className="text-foreground">no era gravity</strong>. History can
              break. A well-run orthodox USSR can stay red long past 1991. A badly mismanaged one
              reforms toward the market and, eventually, out of communism. A hardline government
              with a disciplined plan can hold command indefinitely; a reformist government that
              lets the enterprises fail will marketize.
            </p>
            <Callout variant="tip">
              <strong className="text-foreground">Government reformism is live.</strong> The ruling
              party&apos;s economic position feeds the policy driver directly. Win an election with
              a market-leaning party, or shift the ruling party&apos;s economic stance through
              gameplay, and marketization responds. This works whether the government is player-led
              or run by the state brain.
            </Callout>
          </section>

          {/* ── 7. Feedback loops ── */}
          <section className="space-y-4">
            <SectionHeader id="loops">7. The Feedback Loops</SectionHeader>
            <ul className="list-disc space-y-2 pl-5 text-sm text-muted leading-relaxed">
              <li>
                <strong className="text-foreground">Reform spiral</strong>: underfund the SOEs, they
                miss plan, shortages grow, the black market swells, marketization rises, market
                rules creep in, and eventually the command economy unwinds. A mismanaged state
                collapses early.
              </li>
              <li>
                <strong className="text-foreground">Stable orthodoxy</strong>: fund the right
                sectors, hit the targets, keep the black market contained, and the dial holds. The
                country stays command for as long as you run it well.
              </li>
              <li>
                <strong className="text-foreground">Gosbank tightrope</strong>: print to grow
                output, but watch overhang and shortage climb with it. Growth and empty shelves are
                two sides of the same lever.
              </li>
            </ul>
          </section>

          {/* ── 8. Repression ── */}
          <section className="space-y-4">
            <SectionHeader id="repression">8. Repression: Holding the Line</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Reform is not the only answer to a swelling black market. A hardline government can
              crack down instead. The Gosbank Chair (or head of government) can set an{" "}
              <strong className="text-foreground">internal repression</strong> level that forces the
              second economy down, hides the grey market, and slows the drift toward the market.
            </p>
            <p className="text-sm text-muted leading-relaxed">
              What repression does <strong className="text-foreground">not</strong> do is fix the
              shortage. The shelves are still empty; you have only pushed the trading underground.
              And it is not free: cracking down costs regime legitimacy every turn, and the bill
              grows the harder you push amid scarcity. Heavy repression sitting on top of a deep
              shortage is a pressure cooker that bleeds legitimacy while the underlying problem
              festers.
            </p>
            <Callout variant="warn">
              <strong className="text-foreground">The hardliner tradeoff:</strong> repression buys
              time against reform and keeps the country command for longer, but it treats the
              symptom, not the disease. Deliver the goods and it stays cheap; repress amid empty
              shelves and it becomes expensive fast. Reform or repress, either way the shortage
              still has to be answered.
            </Callout>
          </section>

          {/* ── 9. Planned rules still apply ── */}
          <section className="space-y-4">
            <SectionHeader id="planned-rules">9. The Planned Rules Still Apply</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              While a country sits in the command or dual-track bands, the planned machinery is in
              force. Read shortage, overhang, and the black-market premium as your signals rather
              than waiting for prices or the peg to clear.
            </p>
            <ul className="list-disc space-y-2 pl-5 text-sm text-muted leading-relaxed">
              <li>
                <strong className="text-foreground">Fixed official currency</strong>: in a fully
                command country the official rate is pinned to its era anchor and does not float. Do
                not build forex strategies around it the way you would around USD, GBP, or JPY.
              </li>
              <li>
                <strong className="text-foreground">Passive central bank</strong>: the automatic
                rate setter does not fire, so do not expect rate hikes and cuts to chase inflation
                and growth.
              </li>
              <li>
                <strong className="text-foreground">Administered prices and CPI</strong>: national
                prices are set by the plan, not cleared by S/D, and open inflation sits on the era
                path. Shortage shows up as unmet demand at a held price, not as a price spike.
              </li>
              <li>
                <strong className="text-foreground">Soft budgets</strong>: state firms are not
                dissolved for insolvency the way market corporations are, unless the Gosbank Chair
                runs hard budgets.
              </li>
              <li>
                <strong className="text-foreground">The second economy</strong>: repressed demand
                spills into an informal economy whose size tracks shortage and how far the state
                tolerates it. A tolerated grey market absorbs overhang and narrows the shadow
                premium.
              </li>
            </ul>
          </section>

          {/* ── 10. Dual-track ── */}
          <section className="space-y-4">
            <SectionHeader id="dual-track">10. Dual-Track Transition</SectionHeader>
            <p className="text-sm text-muted leading-relaxed">
              Dual-track means plan and market run in parallel: a share of pricing and shortage
              machinery stays planned, the rest clears like a market. As the marketization level
              climbs through the 30-to-70 band, more of the economy behaves like a market and the
              planned machinery fades. When a country crosses out of the planned bands entirely,
              floating FX, chair policy, S/D pricing, and normal insolvency rules return.
            </p>
          </section>

          {/* ── 11. What to do ── */}
          <section className="space-y-4">
            <SectionHeader id="what-to-do">11. What You Can Do</SectionHeader>
            <SubHeader>As a player</SubHeader>
            <ul className="list-disc space-y-2 pl-5 text-sm text-muted leading-relaxed">
              <li>
                Claim an SOE Director seat and drive one enterprise&apos;s targets, investment, and
                labor-versus-quality mix.
              </li>
              <li>
                As Gosplan Central Planner, set the national quotas and the investment split across
                sectors.
              </li>
              <li>
                As Gosbank Chair, direct credit to the sectors you want to grow and set how soft the
                budgets are, knowing the shortage cost of printing.
              </li>
              <li>
                As a hardliner, set internal repression to force the black market down and resist
                reform, weighing the legitimacy it costs against the shortage it leaves untouched.
              </li>
              <li>
                Read shortage, overhang, and the black-market premium as your early-warning signals,
                and remember marketization now moves with them.
              </li>
              <li>
                Change the country&apos;s direction through elections and party positioning: a
                reformist government marketizes, an orthodox one entrenches.
              </li>
            </ul>
            <SubHeader>What you cannot do</SubHeader>
            <ul className="list-disc space-y-2 pl-5 text-sm text-muted leading-relaxed">
              <li>Turn the regime on or off (admin only).</li>
              <li>Set the world-wide second-economy tolerance (admin only).</li>
              <li>
                Rewrite the era starting level; only the starting value is era-authored, and
                everything after that is earned.
              </li>
            </ul>
            <Callout variant="tip">
              For market mechanics this page deliberately does not repeat, start with{" "}
              <Link href="/guides/commodities" className="text-primary hover:underline">
                Commodities
              </Link>
              ,{" "}
              <Link href="/guides/forex" className="text-primary hover:underline">
                Forex
              </Link>
              , and the{" "}
              <Link href="/guides/investing" className="text-primary hover:underline">
                Investing
              </Link>{" "}
              guide.
            </Callout>
          </section>
        </div>
      </div>
    </div>
  );
}

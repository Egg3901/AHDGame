"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { ActionType } from "@/lib/db/types/gameState";
import type { CharacterRecap, RecapRace } from "@/lib/recap/types";
import { recapAccent } from "@/lib/recap/accent";
import { iterationLabel } from "@/lib/wiki/officeIteration";
import { compact, fmt, money, monthYear, pct, plural, topPercent } from "@/lib/recap/format";
import { actionLabel, guessOptions } from "./story";
import { anim, CareerLadder, RaceBars, RollCall, SeasonStrip, WealthLine } from "./charts";
import { useCountUp, type StoryPlayer } from "./useStoryPlayer";

export interface SlideProps {
  recap: CharacterRecap;
  accent: string;
  motion: boolean;
  player: StoryPlayer;
}

// ── Building blocks ────────────────────────────────────────────────────────

function Slide({ children, align = "center" }: { children: ReactNode; align?: "end" | "center" }) {
  return (
    <div
      className={`flex h-full flex-col px-7 pb-14 pt-20 ${align === "end" ? "justify-end" : "justify-center"}`}
    >
      {children}
    </div>
  );
}

function Label({
  children,
  motion,
  delay = 0,
}: {
  children: ReactNode;
  motion: boolean;
  delay?: number;
}) {
  return (
    <p
      className="mb-4 text-[14px] font-medium text-white/55"
      style={anim(motion, "ahdw-rise", 450, delay)}
    >
      {children}
    </p>
  );
}

/** Hero type steps down for long strings so a figure never wraps mid-number. */
function heroSize(chars: number): string {
  if (chars <= 6) return "clamp(4rem,22vw,6.5rem)";
  if (chars <= 9) return "clamp(3.2rem,16vw,5rem)";
  return "clamp(2.6rem,12vw,3.8rem)";
}

function Hero({
  children,
  motion,
  delay = 80,
  color = "#fff",
  size,
  chars = 6,
}: {
  children: ReactNode;
  motion: boolean;
  delay?: number;
  color?: string;
  size?: string;
  /** Length of the final rendered text, to pick a size that fits on one line. */
  chars?: number;
}) {
  size = size ?? heroSize(chars);
  return (
    <div
      className="whitespace-nowrap font-extrabold leading-[0.92] tabular-nums"
      style={{
        fontSize: size,
        letterSpacing: "-0.045em",
        color,
        ...anim(motion, "ahdw-rise", 550, delay),
      }}
    >
      {children}
    </div>
  );
}

function Title({
  children,
  motion,
  delay = 80,
  color = "#fff",
}: {
  children: ReactNode;
  motion: boolean;
  delay?: number;
  color?: string;
}) {
  return (
    <h2
      className="text-balance font-bold leading-[1.05]"
      style={{
        fontSize: "clamp(1.9rem,8.5vw,2.6rem)",
        letterSpacing: "-0.035em",
        color,
        ...anim(motion, "ahdw-rise", 550, delay),
      }}
    >
      {children}
    </h2>
  );
}

function Sub({
  children,
  motion,
  delay = 200,
}: {
  children: ReactNode;
  motion: boolean;
  delay?: number;
}) {
  return (
    <p
      className="mt-3 text-[17px] font-medium leading-snug text-white/75"
      style={anim(motion, "ahdw-rise", 500, delay)}
    >
      {children}
    </p>
  );
}

function Facts({
  items,
  motion,
  delay = 700,
}: {
  items: Array<ReactNode | null | false>;
  motion: boolean;
  delay?: number;
}) {
  const shown = items.filter(Boolean);
  if (shown.length === 0) return null;
  return (
    <div className="mt-7 flex flex-col gap-2.5">
      {shown.map((item, i) => (
        <p
          key={i}
          className="text-[15px] leading-snug text-white/70"
          style={anim(motion, "ahdw-rise", 450, delay + i * 120)}
        >
          {item}
        </p>
      ))}
    </div>
  );
}

function Count({
  value,
  motion,
  format = fmt,
  ms,
}: {
  value: number;
  motion: boolean;
  format?: (n: number) => string;
  ms?: number;
}) {
  const v = useCountUp(value, true, motion, ms);
  return <>{format(v)}</>;
}

/** A percentile worth saying out loud: the top quarter of a real field. */
function braggable(stat: CharacterRecap["actions"]["rank"]): boolean {
  return Boolean(stat && stat.rank != null && stat.total >= 4 && stat.rank / stat.total <= 0.25);
}

const strong = (s: ReactNode) => <span className="font-semibold text-white">{s}</span>;

function seasonName(r: CharacterRecap): string {
  return r.iteration ? iterationLabel(r.iteration) : "Season";
}

// ── Slides ─────────────────────────────────────────────────────────────────

function OpenSlide({ recap, accent, motion }: SlideProps) {
  const from = recap.world?.startYear ?? recap.arrived?.year;
  const to = recap.world?.endYear ?? recap.departed?.year;
  const progress = useCountUp(1, true, motion, 1800);
  return (
    <Slide>
      <Label motion={motion}>{seasonName(recap)} Wrapped</Label>
      {from != null && to != null && (
        <Hero motion={motion} color={accent} size="clamp(4.5rem,26vw,8rem)">
          {Math.round(from + (to - from) * progress)}
        </Hero>
      )}
      <div className="mt-8" style={anim(motion, "ahdw-rise", 550, 900)}>
        <p className="text-[34px] font-bold leading-none tracking-[-0.03em] text-white">
          {recap.name}
        </p>
        <p className="mt-2 text-[16px] text-white/60">
          {[recap.party, recap.countryName].filter(Boolean).join(" · ")}
        </p>
      </div>
      <Facts
        motion={motion}
        delay={1300}
        items={[
          recap.arrived && recap.departed ? (
            <>
              You played from {strong(monthYear(recap.arrived))} to{" "}
              {strong(monthYear(recap.departed))}.
            </>
          ) : (
            recap.tenureTurns > 0 && <>You played {strong(plural(recap.tenureTurns, "turn"))}.</>
          ),
        ]}
      />
    </Slide>
  );
}

function WorldSlide({ recap, motion }: SlideProps) {
  const w = recap.world!;
  const rows: Array<[number, string]> = [
    [w.players, `politicians in ${plural(w.countries, "country", "countries")}`],
    [w.electionsHeld, "elections held"],
    [w.billsPassed, "bills passed into law"],
  ];
  if (w.conflicts > 0) rows.push([w.conflicts, w.conflicts === 1 ? "war" : "wars"]);
  return (
    <Slide>
      <Label motion={motion}>
        The season, {w.startYear} to {w.endYear}
      </Label>
      <div className="flex flex-col gap-5">
        {rows.map(([n, label], i) => (
          <div key={label} style={anim(motion, "ahdw-rise", 500, 120 + i * 160)}>
            <p className="text-[44px] font-extrabold leading-none tracking-[-0.04em] tabular-nums text-white">
              <Count value={n} motion={motion} />
            </p>
            <p className="mt-1 text-[15px] text-white/60">{label}</p>
          </div>
        ))}
      </div>
      {w.closestRace && (
        <Facts
          motion={motion}
          delay={900}
          items={[
            <>
              The closest race any player stood in: {strong(w.closestRace.label)}
              {w.closestRace.year ? `, ${w.closestRace.year}` : ""}. {w.closestRace.winner} won by{" "}
              {strong(plural(w.closestRace.marginVotes, "vote"))}.
            </>,
          ]}
        />
      )}
    </Slide>
  );
}

function StripSlide({ recap, accent, motion }: SlideProps) {
  const a = recap.activity;
  const won = recap.marks?.some((m) => m.kind === "won");
  return (
    <Slide>
      <Label motion={motion}>Your season, turn by turn</Label>
      <Hero motion={motion} chars={fmt(recap.actions.total).length}>
        <Count value={recap.actions.total} motion={motion} />
      </Hero>
      <Sub motion={motion}>
        {a ? `actions across ${plural(a.activeTurns, "turn")}` : "actions taken"}
        {braggable(recap.actions.rank)
          ? `, ${topPercent(recap.actions.rank)} in ${recap.countryName ?? "your country"}`
          : ""}
      </Sub>
      {a && (
        <div className="mt-8">
          <SeasonStrip
            activity={a}
            marks={recap.marks}
            accent={accent}
            motion={motion}
            height={190}
          />
          <div className="mt-2 flex justify-between text-[12px] tabular-nums text-white/45">
            <span>{recap.arrived?.year}</span>
            {won && <span>White ticks are races you won</span>}
            <span>{recap.departed?.year}</span>
          </div>
        </div>
      )}
      <Facts
        motion={motion}
        delay={1500}
        items={[
          a?.busiest && (
            <>
              Busiest stretch:{" "}
              {strong(`${monthYear(a.busiest.from)} to ${monthYear(a.busiest.to)}`)},{" "}
              {plural(a.busiest.actions, "action")}.
            </>
          ),
          a && a.longestStreak >= 3 && (
            <>Longest streak: {strong(`${fmt(a.longestStreak)} turns`)} in a row.</>
          ),
        ]}
      />
    </Slide>
  );
}

const GUESS_TIMEOUT_MS = 9000;

function GuessSlide({ recap, accent, motion, player }: SlideProps) {
  const options = guessOptions(recap) ?? [];
  const top = recap.actions.topType;
  const [picked, setPicked] = useState<ActionType | null>(null);
  const [revealed, setRevealed] = useState(false);
  const { hold, release } = player;

  useEffect(() => {
    hold();
    const t = window.setTimeout(() => {
      setRevealed(true);
      release();
    }, GUESS_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [hold, release]);

  const choose = (t: ActionType) => {
    if (revealed) return;
    setPicked(t);
    setRevealed(true);
    release();
  };

  const breakdown = (Object.entries(recap.actions.byType) as Array<[ActionType, number]>)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const max = Math.max(1, ...breakdown.map(([, n]) => n));

  return (
    <Slide>
      <Label motion={motion}>Before we show you</Label>
      <Title motion={motion}>What did you do most?</Title>
      {!revealed || picked ? (
        <div className="pointer-events-auto mt-7 flex flex-col gap-3">
          {options.map((t, i) => {
            const right = revealed && t === top;
            const wrong = revealed && picked === t && t !== top;
            return (
              <button
                key={t}
                type="button"
                onClick={() => choose(t)}
                disabled={revealed}
                className="flex items-center justify-between rounded-xl border px-5 py-4 text-left text-[18px] font-semibold transition-colors"
                style={{
                  borderColor: right ? accent : "rgba(255,255,255,.22)",
                  color: right ? accent : wrong ? "rgba(255,255,255,.4)" : "#fff",
                  textDecoration: wrong ? "line-through" : undefined,
                  ...anim(motion, "ahdw-rise", 450, 200 + i * 100),
                }}
              >
                <span>{actionLabel(t)}</span>
                {revealed && (
                  <span className="text-[14px] font-medium tabular-nums text-white/60">
                    {plural(recap.actions.byType[t] ?? 0, "time")}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : null}
      {revealed && (
        <div className="mt-7">
          <p className="text-[16px] text-white/75" style={anim(motion, "ahdw-rise", 450, 0)}>
            {picked == null ? "Time's up. " : picked === top ? "Correct. " : "Not quite. "}
            {top ? (
              <>
                {strong(actionLabel(top))}, {plural(recap.actions.byType[top] ?? 0, "time")}.
              </>
            ) : null}
          </p>
          {picked == null && (
            <ul className="mt-5 flex flex-col gap-3">
              {breakdown.map(([t, n], i) => (
                <li key={t} style={anim(motion, "ahdw-rise", 400, 150 + i * 90)}>
                  <div className="flex justify-between text-[14px]">
                    <span className="text-white/85">{actionLabel(t)}</span>
                    <span className="tabular-nums text-white/55">{fmt(n)}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(n / max) * 100}%`,
                        background: t === top ? accent : "rgba(255,255,255,.35)",
                        transformOrigin: "left",
                        ...anim(motion, "ahdw-widen", 800, 250 + i * 90),
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Slide>
  );
}

function climbLine(climb: NonNullable<CharacterRecap["climb"]>): string {
  const first = climb[0]?.date.year ?? 0;
  const years = (climb.at(-1)?.date.year ?? first) - first;
  return years >= 1
    ? `${plural(climb.length, "step")} up over ${plural(years, "game year")}.`
    : `${plural(climb.length, "step")} up, all in ${first}.`;
}

function ClimbSlide({ recap, accent, motion }: SlideProps) {
  const climb = recap.climb ?? [];
  const top = climb.at(-1)?.label ?? recap.highestOffice ?? "";
  if (climb.length <= 1) {
    return (
      <Slide>
        <Label motion={motion}>Highest office</Label>
        <Title motion={motion} color={accent}>
          {top}
        </Title>
        <Sub motion={motion}>
          {climb[0]
            ? `You took office in ${monthYear(climb[0].date)}.`
            : "The highest office you held this season."}
        </Sub>
      </Slide>
    );
  }
  return (
    <Slide>
      <Label motion={motion}>Your climb</Label>
      <CareerLadder climb={climb} accent={accent} motion={motion} />
      <Facts motion={motion} delay={600 + climb.length * 200} items={[climbLine(climb)]} />
    </Slide>
  );
}

function marginLine(race: RecapRace): string {
  const verb = race.won ? "Won" : "Lost";
  return `${verb} by ${pct(Math.abs(race.marginPct))} points, ${plural(Math.abs(race.marginVotes), "vote")}.`;
}

function RaceBlock({
  heading,
  race,
  accent,
  motion,
  delay,
  rows,
}: {
  heading: string;
  race: RecapRace;
  accent: string;
  motion: boolean;
  delay: number;
  rows: number;
}) {
  const trimmed = { ...race, field: race.field.slice(0, rows) };
  if (!trimmed.field.some((f) => f.isYou)) {
    const you = race.field.find((f) => f.isYou);
    if (you) trimmed.field[trimmed.field.length - 1] = you;
  }
  return (
    <section>
      <p className="text-[13px] text-white/50" style={anim(motion, "ahdw-rise", 400, delay)}>
        {heading}
      </p>
      <p
        className="mb-4 mt-1 text-[22px] font-bold leading-tight tracking-[-0.02em]"
        style={anim(motion, "ahdw-rise", 450, delay + 60)}
      >
        {race.label}
        {race.year ? <span className="font-medium text-white/50">, {race.year}</span> : null}
      </p>
      <RaceBars race={trimmed} accent={accent} motion={motion} delay={delay + 120} />
      <p
        className="mt-3 text-[15px] font-medium text-white/80"
        style={anim(motion, "ahdw-rise", 450, delay + 900)}
      >
        {marginLine(race)}
      </p>
    </section>
  );
}

function RaceSlide({ recap, accent, motion }: SlideProps) {
  const r = recap.races!;
  const main = r.bestWin ?? r.closest!;
  const second = r.bestWin ? r.closest : null;
  return (
    <Slide>
      <Label motion={motion}>Election night</Label>
      <div className="flex flex-col gap-8">
        <RaceBlock
          heading={r.bestWin ? "Your biggest win" : "Your closest race"}
          race={main}
          accent={accent}
          motion={motion}
          delay={100}
          rows={second ? 3 : 4}
        />
        {second && (
          <RaceBlock
            heading="Your closest race"
            race={second}
            accent={accent}
            motion={motion}
            delay={1400}
            rows={2}
          />
        )}
      </div>
      {r.totalVotes > 0 && (
        <Facts
          motion={motion}
          delay={second ? 2400 : 1300}
          items={[
            <>
              {strong(fmt(r.totalVotes))} votes for you across {plural(r.contested, "race")}.
            </>,
          ]}
        />
      )}
    </Slide>
  );
}

function VotesSlide({ recap, motion }: SlideProps) {
  const r = recap.races;
  const e = recap.elections;
  return (
    <Slide>
      <Label motion={motion}>On the ballot</Label>
      {r && r.totalVotes > 0 ? (
        <>
          <Hero motion={motion}>
            <Count
              value={r.totalVotes}
              motion={motion}
              format={(n) => (r.totalVotes >= 1e6 ? compact(n) : fmt(n))}
            />
          </Hero>
          <Sub motion={motion}>votes cast for you</Sub>
        </>
      ) : (
        <>
          <Hero motion={motion}>
            <Count value={e.won} motion={motion} />
          </Hero>
          <Sub motion={motion}>{e.won === 1 ? "race won" : "races won"}</Sub>
        </>
      )}
      <Facts
        motion={motion}
        items={[
          e.entered > 0 && (
            <>
              You stood in {strong(plural(e.entered, "race"))} and won {strong(fmt(e.won))}.
            </>
          ),
          r?.firstWin && (
            <>
              First win: {strong(r.firstWin.label)}
              {r.firstWin.year ? `, ${r.firstWin.year}` : ""}.
            </>
          ),
        ]}
      />
    </Slide>
  );
}

function RivalSlide({ recap, accent, motion }: SlideProps) {
  const rival = recap.races!.rival!;
  const rivalColor = recapAccent(rival.color);
  const first = rival.name.split(" ")[0];
  return (
    <Slide>
      <Label motion={motion}>Your rival</Label>
      <Title motion={motion} color={rivalColor}>
        {rival.name}
      </Title>
      <p className="mt-2 text-[15px] text-white/55" style={anim(motion, "ahdw-rise", 450, 150)}>
        {rival.partyName}
      </p>
      <div className="mt-8 grid grid-cols-2 gap-6" style={anim(motion, "ahdw-rise", 500, 400)}>
        <div>
          <p
            className="text-[64px] font-extrabold leading-none tabular-nums tracking-[-0.04em]"
            style={{ color: accent }}
          >
            <Count value={rival.ahead} motion={motion} />
          </p>
          <p className="mt-1 text-[14px] text-white/60">
            {rival.ahead === 1 ? "time" : "times"} you finished ahead
          </p>
        </div>
        <div>
          <p
            className="text-[64px] font-extrabold leading-none tabular-nums tracking-[-0.04em]"
            style={{ color: rivalColor }}
          >
            <Count value={rival.behind} motion={motion} />
          </p>
          <p className="mt-1 text-[14px] text-white/60">
            {rival.behind === 1 ? "time" : "times"} {first} did
          </p>
        </div>
      </div>
      <ul className="mt-8 flex flex-col gap-2">
        {rival.history.map((h, i) => (
          <li
            key={i}
            className="flex items-baseline gap-3 text-[14px]"
            style={anim(motion, "ahdw-rise", 400, 900 + i * 110)}
          >
            <span className="w-10 shrink-0 tabular-nums text-white/45">{h.year ?? ""}</span>
            <span className="min-w-0 flex-1 truncate text-white/80">{h.label}</span>
            <span
              className="shrink-0 font-semibold"
              style={{ color: h.ahead ? accent : rivalColor }}
            >
              {h.ahead ? "You" : first}
            </span>
          </li>
        ))}
      </ul>
    </Slide>
  );
}

function LawSlide({ recap, accent, motion }: SlideProps) {
  const leg = recap.legislation;
  const sig = leg?.signature ?? null;
  const decisive = leg?.decisive.find((d) => d.title !== sig?.title) ?? null;
  const featured = sig ?? leg?.decisive[0] ?? null;
  const loyalty =
    leg?.partyLoyaltyPct != null ? (
      <>
        You sided with your party on {strong(pct(leg.partyLoyaltyPct, 0))} of{" "}
        {plural(leg.votesCast, "vote")}.
      </>
    ) : (
      leg && leg.votesCast > 0 && <>You cast {strong(plural(leg.votesCast, "roll-call vote"))}.</>
    );
  if (!featured) {
    return (
      <Slide>
        <Label motion={motion}>On the floor</Label>
        <Hero motion={motion}>
          <Count value={leg?.votesCast || recap.bills.sponsored} motion={motion} />
        </Hero>
        <Sub motion={motion}>{leg?.votesCast ? "roll-call votes cast" : "bills sponsored"}</Sub>
        <Facts
          motion={motion}
          items={[
            recap.bills.sponsored > 0 && (
              <>
                {plural(recap.bills.sponsored, "bill")} sponsored, {strong(fmt(recap.bills.passed))}{" "}
                passed.
              </>
            ),
            leg?.partyLoyaltyPct != null && loyalty,
          ]}
        />
      </Slide>
    );
  }
  return (
    <Slide>
      <Label motion={motion}>
        {sig ? "Your signature bill" : "The vote that came down to you"}
      </Label>
      <h2
        className="line-clamp-3 text-balance text-[28px] font-bold leading-[1.08] tracking-[-0.03em]"
        style={anim(motion, "ahdw-rise", 500, 80)}
      >
        {featured.title}
      </h2>
      <p
        className="mt-3 text-[16px] font-medium text-white/75"
        style={anim(motion, "ahdw-rise", 450, 200)}
      >
        <span style={{ color: featured.passed ? accent : "#fff" }}>
          {featured.passed ? "Passed" : "Failed"}
        </span>{" "}
        {fmt(featured.for)} to {fmt(featured.against)}
        {featured.year ? `, ${featured.year}` : ""}
      </p>
      <div className="mt-6">
        <RollCall
          tally={{ for: featured.for, against: featured.against, abstain: featured.abstain }}
          yourVote={featured.yourVote}
          accent={accent}
          motion={motion}
          delay={350}
        />
        <p className="mt-3 text-[12px] text-white/45" style={anim(motion, "ahdw-fade", 400, 1300)}>
          Each dot is 1% of the vote: filled for, ringed against.{" "}
          {featured.yourVote ? "Yours is in color." : ""}
        </p>
      </div>
      <Facts
        motion={motion}
        delay={1600}
        items={[
          !sig && "The margin was smaller than your own vote.",
          sig && decisive && (
            <>
              The {strong(decisive.title)} {decisive.passed ? "passed" : "failed"}{" "}
              {fmt(decisive.for)} to {fmt(decisive.against)}, a margin smaller than your own vote.
            </>
          ),
          loyalty,
        ]}
      />
    </Slide>
  );
}

function FortuneSlide({ recap, accent, motion }: SlideProps) {
  const w = recap.wealth;
  const nw = recap.netWorth ?? recap.campaignFunds;
  const neighbors = recap.netWorth?.neighbors;
  const rankLine = recap.netWorth?.rank != null && (
    <>
      Net worth with campaign funds: {strong(money(recap, recap.netWorth.value))}, No.{" "}
      {fmt(recap.netWorth.rank)} of {fmt(recap.netWorth.total)} across every country
      {neighbors?.above && neighbors.below
        ? `, between ${neighbors.above.name} and ${neighbors.below.name}`
        : ""}
      .
    </>
  );
  if (w?.peak) {
    return (
      <Slide>
        <Label motion={motion}>Personal fortune</Label>
        <Hero motion={motion} chars={money(recap, w.peak.value).length}>
          <Count value={w.peak.value} motion={motion} format={(n) => money(recap, n)} />
        </Hero>
        <Sub motion={motion}>at its peak in {monthYear(w.peak.date)}</Sub>
        <div className="mt-8">
          <WealthLine wealth={w} accent={accent} motion={motion} height={180} />
        </div>
        <Facts
          motion={motion}
          delay={1700}
          items={[
            <>Personal holdings at the end: {strong(money(recap, w.points.at(-1) ?? 0))}.</>,
            rankLine,
          ]}
        />
      </Slide>
    );
  }
  return (
    <Slide>
      <Label motion={motion}>{recap.netWorth ? "Net worth" : "Campaign funds"}</Label>
      <Hero motion={motion} chars={money(recap, nw?.value ?? 0).length}>
        <Count value={nw?.value ?? 0} motion={motion} format={(n) => money(recap, n)} />
      </Hero>
      <Facts motion={motion} items={[rankLine]} />
    </Slide>
  );
}

function StandingSlide({ recap, accent, motion }: SlideProps) {
  const npi = recap.influence.npi;
  const fav = recap.favorability;
  const place = recap.countryName ?? "your country";
  const rows: Array<{ rank: number; name: string; value: number; you: boolean }> = [];
  if (npi?.rank != null) {
    if (npi.neighbors?.above)
      rows.push({
        rank: npi.rank - 1,
        name: npi.neighbors.above.name,
        value: npi.neighbors.above.value,
        you: false,
      });
    rows.push({ rank: npi.rank, name: recap.name, value: npi.value, you: true });
    if (npi.neighbors?.below)
      rows.push({
        rank: npi.rank + 1,
        name: npi.neighbors.below.name,
        value: npi.neighbors.below.value,
        you: false,
      });
  }
  return (
    <Slide>
      <Label motion={motion}>Final standings</Label>
      {npi?.rank != null && (
        <>
          <Title motion={motion}>
            No. {fmt(npi.rank)} of {fmt(npi.total)}
          </Title>
          <Sub motion={motion}>for national influence in {place}</Sub>
          <ol className="mt-7 flex flex-col">
            {rows.map((row, i) => (
              <li
                key={row.rank}
                className="flex items-baseline gap-4 border-t border-white/10 py-3 last:border-b"
                style={anim(motion, "ahdw-rise", 450, 400 + i * 140)}
              >
                <span className="w-8 shrink-0 text-[15px] tabular-nums text-white/45">
                  {row.rank}
                </span>
                <span
                  className="min-w-0 flex-1 truncate text-[17px] font-semibold"
                  style={{ color: row.you ? accent : "rgba(255,255,255,.75)" }}
                >
                  {row.name}
                </span>
                <span className="shrink-0 text-[15px] tabular-nums text-white/60">
                  {fmt(row.value)}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
      <Facts
        motion={motion}
        delay={1100}
        items={[
          fav?.rank != null && (
            <>
              Favorability {strong(`${fmt(fav.value)}%`)}, No. {fmt(fav.rank)} of {fmt(fav.total)}{" "}
              in {place}.
            </>
          ),
          recap.infamy > 0 && <>Infamy {strong(fmt(recap.infamy))}.</>,
        ]}
      />
    </Slide>
  );
}

function WireSlide({ recap, motion }: SlideProps) {
  const so = recap.social!;
  return (
    <Slide>
      <Label motion={motion}>On the wire</Label>
      <Hero motion={motion}>
        <Count value={so.posts} motion={motion} />
      </Hero>
      <Sub motion={motion}>{so.posts === 1 ? "post published" : "posts published"}</Sub>
      <Facts
        motion={motion}
        items={[
          so.subscribers > 0 && <>{strong(plural(so.subscribers, "subscriber"))}.</>,
          so.likes > 0 && <>{strong(plural(so.likes, "agree", "agrees"))} on your posts.</>,
        ]}
      />
    </Slide>
  );
}

function HonorsSlide({ recap, motion }: SlideProps) {
  const a = recap.achievements;
  return (
    <Slide>
      <Label motion={motion}>Achievements</Label>
      <Hero motion={motion}>
        <Count value={a.count} motion={motion} />
      </Hero>
      <Sub motion={motion}>{a.count === 1 ? "achievement earned" : "achievements earned"}</Sub>
      <Facts
        motion={motion}
        items={a.highlights.slice(0, 3).map((h) => (
          <>{strong(h.name)}</>
        ))}
      />
    </Slide>
  );
}

function AwardsSlide({ recap, accent, motion }: SlideProps) {
  const awards = recap.awards ?? [];
  return (
    <Slide>
      <Label motion={motion}>Season awards</Label>
      <ul className="flex flex-col gap-5">
        {awards.map((a, i) => (
          <li
            key={a.title}
            className="flex gap-4"
            style={anim(motion, "ahdw-rise", 500, 150 + i * 220)}
          >
            <span
              className="w-7 shrink-0 pt-0.5 text-[22px] font-extrabold tabular-nums leading-none"
              style={{
                color: a.scope === "world" && a.rank === 1 ? accent : "rgba(255,255,255,.4)",
              }}
            >
              {a.rank}
            </span>
            <span>
              <span className="block text-[19px] font-semibold leading-tight tracking-[-0.015em] text-white">
                {a.title}
              </span>
              <span className="mt-0.5 block text-[14px] text-white/55">{a.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </Slide>
  );
}

function PersonaSlide({ recap, accent, motion }: SlideProps) {
  const p = recap.persona!;
  return (
    <Slide>
      <Label motion={motion}>How you played</Label>
      <h2
        className="text-balance font-extrabold leading-[0.95]"
        style={{
          fontSize: "clamp(2.9rem,14vw,4.4rem)",
          letterSpacing: "-0.045em",
          color: accent,
          ...anim(motion, "ahdw-rise", 550, 80),
        }}
      >
        {p.title}
      </h2>
      <Sub motion={motion} delay={500}>
        {p.reason}
      </Sub>
    </Slide>
  );
}

export const SLIDES: Record<string, (p: SlideProps) => ReactNode> = {
  open: OpenSlide,
  world: WorldSlide,
  strip: StripSlide,
  guess: GuessSlide,
  climb: ClimbSlide,
  race: RaceSlide,
  votes: VotesSlide,
  rival: RivalSlide,
  law: LawSlide,
  fortune: FortuneSlide,
  standing: StandingSlide,
  wire: WireSlide,
  honors: HonorsSlide,
  awards: AwardsSlide,
  persona: PersonaSlide,
};

export { seasonName };

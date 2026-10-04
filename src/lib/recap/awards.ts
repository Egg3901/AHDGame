import type { CharacterRecap, RecapAward, RecapPersona } from "./types";
import { fmt, ordinal, pct, plural, topPercent } from "./format";

/**
 * Season awards and the persona line. Both run after every recap in the cohort
 * is assembled, because an award is a comparison across the whole field. A solo
 * mid-season retirement gets a persona but no awards.
 */

interface Metric {
  key: string;
  /** "most races won" style noun phrase, used as "{phrase} in {place}". */
  phrase: string;
  value: (r: CharacterRecap) => number;
  detail: (r: CharacterRecap) => string;
  worldOnly?: boolean;
}

const METRICS: Metric[] = [
  {
    key: "races",
    phrase: "races won",
    value: (r) => r.elections.won,
    detail: (r) => plural(r.elections.won, "race") + " won",
  },
  {
    key: "votes",
    phrase: "votes received",
    value: (r) => r.races?.totalVotes ?? 0,
    detail: (r) => `${fmt(r.races?.totalVotes ?? 0)} votes`,
  },
  {
    key: "landslide",
    phrase: "biggest landslide",
    value: (r) => (r.races?.bestWin ? r.races.bestWin.marginPct : 0),
    detail: (r) =>
      r.races?.bestWin ? `Won ${r.races.bestWin.label} by ${pct(r.races.bestWin.marginPct)}` : "",
    worldOnly: true,
  },
  {
    key: "actions",
    phrase: "actions taken",
    value: (r) => r.actions.total,
    detail: (r) => plural(r.actions.total, "action"),
  },
  {
    key: "laws",
    phrase: "bills passed",
    value: (r) => r.bills.passed,
    detail: (r) => `${plural(r.bills.passed, "bill")} passed`,
  },
  {
    key: "rollcalls",
    phrase: "roll-call votes cast",
    value: (r) => r.legislation?.votesCast ?? 0,
    detail: (r) => plural(r.legislation?.votesCast ?? 0, "vote"),
  },
  {
    key: "influence",
    phrase: "national influence",
    value: (r) => r.influence.nationalInfluence,
    detail: (r) => `${fmt(r.influence.nationalInfluence)} influence`,
  },
  {
    key: "favorability",
    phrase: "favorability",
    value: (r) => (r.favorability?.value ?? 0) - 50,
    detail: (r) => `${fmt(r.favorability?.value ?? 0)}% favorability`,
  },
  {
    key: "subscribers",
    phrase: "subscribers on the wire",
    value: (r) => r.social?.subscribers ?? 0,
    detail: (r) => plural(r.social?.subscribers ?? 0, "subscriber"),
  },
  {
    key: "streak",
    phrase: "longest streak",
    value: (r) => r.activity?.longestStreak ?? 0,
    detail: (r) => `${fmt(r.activity?.longestStreak ?? 0)} turns in a row`,
    worldOnly: true,
  },
  {
    key: "achievements",
    phrase: "achievements",
    value: (r) => r.achievements.count,
    detail: (r) => plural(r.achievements.count, "achievement"),
    worldOnly: true,
  },
];

const WORLD_PODIUM = 3;
const MIN_WORLD_FIELD = 5;
const MIN_COUNTRY_FIELD = 3;
const MAX_AWARDS = 6;

function rankDesc(rows: CharacterRecap[], value: (r: CharacterRecap) => number) {
  return rows
    .map((r) => ({ r, v: value(r) }))
    .filter((e) => e.v > 0)
    .sort((a, b) => b.v - a.v);
}

function title(rank: number, phrase: string, place: string): string {
  const lead = rank === 1 ? "Most" : `${ordinal(rank)} most`;
  if (phrase === "biggest landslide")
    return rank === 1
      ? `Biggest landslide ${place}`
      : `${ordinal(rank)} biggest landslide ${place}`;
  if (phrase === "longest streak")
    return rank === 1 ? `Longest streak ${place}` : `${ordinal(rank)} longest streak ${place}`;
  if (phrase === "national influence" || phrase === "favorability")
    return `${rank === 1 ? "Highest" : `${ordinal(rank)} highest`} ${phrase} ${place}`;
  return `${lead} ${phrase} ${place}`;
}

/** Awards per characterId: world podium (top 3) and country firsts. */
export function assignAwards(recaps: CharacterRecap[]): Map<string, RecapAward[]> {
  const out = new Map<string, RecapAward[]>();
  const push = (id: string, a: RecapAward) => out.set(id, [...(out.get(id) ?? []), a]);
  const byCountry = new Map<string, CharacterRecap[]>();
  for (const r of recaps) byCountry.set(r.countryId, [...(byCountry.get(r.countryId) ?? []), r]);

  for (const m of METRICS) {
    const worldWinners = new Set<string>();
    if (recaps.length >= MIN_WORLD_FIELD) {
      rankDesc(recaps, m.value)
        .slice(0, WORLD_PODIUM)
        .forEach((e, i) => {
          worldWinners.add(e.r.characterId);
          push(e.r.characterId, {
            title: title(i + 1, m.phrase, "in the world"),
            scope: "world",
            rank: i + 1,
            detail: m.detail(e.r),
          });
        });
    }
    if (m.worldOnly) continue;
    for (const rows of byCountry.values()) {
      if (rows.length < MIN_COUNTRY_FIELD) continue;
      const first = rankDesc(rows, m.value)[0];
      if (!first || worldWinners.has(first.r.characterId)) continue;
      push(first.r.characterId, {
        title: title(1, m.phrase, `in ${first.r.countryName ?? first.r.countryId}`),
        scope: "country",
        rank: 1,
        detail: m.detail(first.r),
      });
    }
  }

  for (const [id, awards] of out) {
    awards.sort(
      (a, b) => (a.scope === "world" ? 0 : 1) - (b.scope === "world" ? 0 : 1) || a.rank - b.rank
    );
    out.set(id, awards.slice(0, MAX_AWARDS));
  }
  return out;
}

function share(r: CharacterRecap, ...types: string[]): number {
  if (r.actions.total <= 0) return 0;
  const byType = r.actions.byType as Record<string, number | undefined>;
  return types.reduce((s, t) => s + (byType[t] ?? 0), 0) / r.actions.total;
}

const MIN_MIX_ACTIONS = 40;

/**
 * One plain label for how this character played, with the number that earned
 * it. First matching rule wins; rules run rarest first.
 */
export function buildPersona(r: CharacterRecap): RecapPersona {
  const top = r.climb?.at(-1);
  if (top && top.rank >= 8) {
    return {
      key: "leader",
      title: "The Leader",
      reason: `You reached ${top.label}, the top office in ${r.countryName ?? "your country"}.`,
    };
  }
  const decisive = r.legislation?.decisive.length ?? 0;
  if (r.bills.passed >= 3 || (decisive >= 1 && (r.legislation?.votesCast ?? 0) >= 50)) {
    return {
      key: "lawmaker",
      title: "The Lawmaker",
      reason:
        r.bills.passed >= 3
          ? `${fmt(r.bills.passed)} of your bills became law.`
          : `You cast ${fmt(r.legislation?.votesCast ?? 0)} roll-call votes and ${plural(decisive, "outcome")} turned on yours.`,
    };
  }
  if (r.elections.won >= 4 && r.elections.won / Math.max(1, r.elections.entered) >= 0.75) {
    return {
      key: "closer",
      title: "The Closer",
      reason: `You won ${fmt(r.elections.won)} of the ${fmt(r.elections.entered)} races you stood in.`,
    };
  }
  const wealthTop = topPercent(r.netWorth);
  if (
    r.netWorth?.rank != null &&
    r.netWorth.total >= 10 &&
    r.netWorth.rank / r.netWorth.total <= 0.05
  ) {
    return {
      key: "tycoon",
      title: "The Tycoon",
      reason: `${wealthTop} for net worth across every country.`,
    };
  }
  if ((r.activity?.longestStreak ?? 0) >= 100) {
    return {
      key: "workhorse",
      title: "The Workhorse",
      reason: `You acted on ${fmt(r.activity?.longestStreak ?? 0)} turns in a row.`,
    };
  }
  if (r.actions.total >= MIN_MIX_ACTIONS) {
    const mixes: Array<[string, string, number]> = [
      ["fundraiser", "The Fundraiser", share(r, "fundraise", "buildDonorBase")],
      ["campaigner", "The Campaigner", share(r, "campaign", "advertise")],
      ["pollster", "The Pollster", share(r, "poll", "pollLarge")],
      ["debater", "The Debater", share(r, "debatePrep")],
    ];
    const thresholds: Record<string, number> = {
      fundraiser: 0.4,
      campaigner: 0.4,
      pollster: 0.25,
      debater: 0.25,
    };
    const best = mixes.filter(([key, , s]) => s >= thresholds[key]).sort((a, b) => b[2] - a[2])[0];
    if (best) {
      const [key, label, s] = best;
      const what: Record<string, string> = {
        fundraiser: "raised money or built your donor base",
        campaigner: "campaigned or ran ads",
        pollster: "commissioned polls",
        debater: "prepared for debates",
      };
      return { key, title: label, reason: `${pct(s * 100, 0)} of your actions ${what[key]}.` };
    }
  }
  if ((r.social?.posts ?? 0) >= 30) {
    return {
      key: "columnist",
      title: "The Columnist",
      reason: `You published ${fmt(r.social?.posts ?? 0)} posts on the wire.`,
    };
  }
  if (r.elections.entered >= 3 && r.elections.won === 0) {
    return {
      key: "persistent",
      title: "The Persistent",
      reason: `You stood in ${plural(r.elections.entered, "race")} without a win.`,
    };
  }
  if (r.tenureTurns < 150) {
    return {
      key: "newcomer",
      title: "The Newcomer",
      reason: `You joined late and played ${fmt(r.tenureTurns)} turns.`,
    };
  }
  return {
    key: "backbencher",
    title: "The Backbencher",
    reason: `${plural(r.actions.total, "action")} across ${fmt(Math.max(1, Math.round(r.tenureTurns / 48)))} game years.`,
  };
}

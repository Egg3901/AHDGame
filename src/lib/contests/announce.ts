/**
 * Results of a settlement batch: one National Wire Service post listing every
 * contest's paid places, and one notification per player who finished ranked
 * without placing (placed players already get their prize notification).
 */
import type { ObjectId } from "mongodb";
import type { ContestKind, ContestStanding, ContestWinner } from "@/lib/db/types/contestRound";
import { createSystemNewsPost } from "@/lib/news";
import { createNotifications, type NotificationInput } from "@/lib/notifications";
import { CONTEST_KIND_TITLES } from "./prize";

export interface SettledRoundResult {
  kind: ContestKind;
  roundNumber: number;
  standings: ContestStanding[];
  winners: ContestWinner[];
}

const PLACE_LABELS = ["1st", "2nd", "3rd"];

export function formatContestScore(kind: ContestKind, score: number): string {
  const fmt = (digits: number) =>
    new Intl.NumberFormat("en-US", {
      maximumFractionDigits: digits,
      signDisplay: "exceptZero",
    }).format(score);
  switch (kind) {
    case "corp_growth_small":
    case "corp_growth_large":
      return `${fmt(1)}%`;
    case "influence_gain":
      return `${fmt(0)} NI`;
    case "approval_gain":
      return `${fmt(1)} pts`;
    case "referrals_weekly":
      return score === 1 ? "1 referral" : `${score} referrals`;
    case "legislator_bills":
      return score === 1 ? "1 bill enacted" : `${score} bills enacted`;
    case "wealth_growth":
      return `${fmt(1)}%`;
    case "party_growth":
      return `${fmt(0)} members`;
    default:
      return fmt(1);
  }
}

function formatAnchor(amount: number): string {
  return `₳${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(amount)}`;
}

function entryName(kind: ContestKind, e: { subjectName: string; characterName: string }): string {
  return e.subjectName === e.characterName || kind === "referrals_weekly"
    ? e.subjectName
    : `${e.subjectName} (${e.characterName})`;
}

/** Plain-text body of the weekly results post. */
export function contestResultsPost(results: readonly SettledRoundResult[]): string {
  const sections = results.map((r) => {
    const title = `${CONTEST_KIND_TITLES[r.kind]}, round ${r.roundNumber}`;
    if (r.winners.length === 0) return `${title}\nNo entry finished ahead this week.`;
    const lines = r.winners.map((w) => {
      const place = PLACE_LABELS[(w.rank ?? 1) - 1] ?? `#${w.rank}`;
      const prize = w.prizeAnchor ? `, wins ${formatAnchor(w.prizeAnchor)}` : "";
      return `${place}: ${entryName(r.kind, w)}, ${formatContestScore(r.kind, w.score)}${prize}`;
    });
    return [title, ...lines].join("\n");
  });
  return `This week's contests have closed.\n\n${sections.join("\n\n")}\n\nNew rounds are open now on the Contests page.`;
}

/**
 * One notification per player with a ranked, non-placing entry, covering every
 * contest they finished in.
 */
export function contestResultNotifications(
  results: readonly SettledRoundResult[],
  userIdByCharacter: ReadonlyMap<string, ObjectId>
): NotificationInput[] {
  const lines = new Map<string, string[]>();
  for (const r of results) {
    const placed = new Set(r.winners.map((w) => w.subjectId));
    r.standings.forEach((s, i) => {
      // Idle entries (no change all week) are not worth a notification.
      if (placed.has(s.subjectId) || s.score === 0 || !userIdByCharacter.has(s.characterId)) return;
      const list = lines.get(s.characterId) ?? [];
      list.push(
        `${CONTEST_KIND_TITLES[r.kind]}: #${i + 1} of ${r.standings.length} (${formatContestScore(r.kind, s.score)})`
      );
      lines.set(s.characterId, list);
    });
  }
  return [...lines].map(([characterId, list]) => ({
    userId: userIdByCharacter.get(characterId)!,
    type: "system",
    title: "Weekly contest results",
    message: `This week's contests have closed. ${list.join(". ")}. New rounds are open now.`,
    metadata: { href: "/contests" },
  }));
}

/** Post the results and notify entrants. Never throws. */
export async function announceContestResults(
  results: readonly SettledRoundResult[],
  userIdByCharacter: ReadonlyMap<string, ObjectId>
): Promise<void> {
  if (results.length === 0) return;
  try {
    await createSystemNewsPost(contestResultsPost(results), "general", {
      title: "Weekly contest results",
    });
  } catch (err) {
    console.error("[contests] results post failed", err);
  }
  await createNotifications(contestResultNotifications(results, userIdByCharacter));
}

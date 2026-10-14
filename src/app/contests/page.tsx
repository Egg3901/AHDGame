import { iterationLabel } from "@/lib/wiki/officeIteration";
import Link from "next/link";
import {
  loadContestHistory,
  loadContestChampions,
  HISTORY_PAGE_SIZE,
  type ContestHistoryData,
  type ContestChampion,
} from "@/lib/contests/history";
import { CONTEST_KINDS } from "@/lib/contests/rules";
import { getLegacyLeaderboardData } from "@/lib/world/legacyLeaderboard";
import LegacyLeaderboardClient from "@/app/world/legacy/LegacyLeaderboardClient";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { getDb } from "@/lib/mongodb";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { publicPageMetadata } from "@/lib/siteMetadata";
import { LocalTime } from "@/components/time/LocalTime";
import type { ContestRecordKind } from "@/lib/db/types/contestRound";
import {
  loadContestsPage,
  type ContestCardData,
  type PastRoundData,
  type ReferralBoardData,
} from "@/lib/contests/queries";
import { ensureContestsOpen } from "@/lib/contests/engine";
import { isSingleplayer } from "@/lib/singleplayer";
import { CONTEST_CATEGORY, prizeShares } from "@/lib/contests/rules";
import { ChevronRight } from "lucide-react";
import { ContestEntry } from "./ContestEntry";
import { ReferralInviteLink } from "./ReferralInviteLink";
import { RoundCountdown } from "./RoundCountdown";

export const metadata: Metadata = publicPageMetadata({
  title: "Contests | A House Divided",
  description:
    "Weekly contests across business, politics and government: company and wealth growth, comebacks, National Influence, public image, kingmaking, approval, legislation and party growth, plus the referral leaderboard.",
  pathname: "/contests",
});

export const dynamic = "force-dynamic";

type T = Awaited<ReturnType<typeof getTranslations<"contests">>>;

const DATE_OPTIONS: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };

function formatIteration(key: string | null, t: T): string {
  const [type, number] = key?.split(":") ?? [];
  if ((type === "Alpha" || type === "Beta" || type === "Iteration") && /^\d+$/.test(number ?? "")) {
    return iterationLabel({ type, number: Number(number) });
  }
  return key ?? t("history.unknownIteration");
}

/** A contest's unit, applied to a score (signed) or a gap (unsigned). */
function formatUnit(
  t: T,
  locale: string,
  kind: ContestRecordKind,
  amount: number,
  signed: boolean
): string {
  if (kind === "referrals_weekly" || kind === "referrals_iteration") {
    return t("scores.referrals", { count: amount });
  }
  if (kind === "legislator_bills") return t("scores.bills", { count: amount });
  if (kind === "kingmaker") return t("scores.races", { count: amount });
  const influence =
    kind === "influence_gain" || kind === "rookie_influence" || kind === "backbench_influence";
  const whole = influence || kind === "party_growth";
  const value = new Intl.NumberFormat(locale, {
    maximumFractionDigits: whole ? 0 : 1,
    ...(signed ? { signDisplay: "exceptZero" as const } : {}),
  }).format(amount);
  if (influence) return t("scores.influence", { value });
  if (kind === "approval_gain" || kind === "governor_approval" || kind === "favorability_gain") {
    return t("scores.approval", { value });
  }
  if (kind === "party_growth") return t("scores.members", { value });
  return t("scores.percent", { value });
}

function formatScore(t: T, locale: string, kind: ContestRecordKind, score: number): string {
  return formatUnit(t, locale, kind, score, true);
}

/** Gap to the leader in the contest's own unit, without a sign. */
function formatGap(t: T, locale: string, kind: ContestRecordKind, gap: number): string {
  return formatUnit(t, locale, kind, gap, false);
}

/** Entries that are a character need no owner; corporations, parties and governments name theirs. */
function showsOwner(kind: ContestRecordKind): boolean {
  return (
    kind === "corp_growth_small" ||
    kind === "corp_growth_large" ||
    kind === "corp_comeback" ||
    kind === "approval_gain" ||
    kind === "governor_approval" ||
    kind === "party_growth"
  );
}

function formatAnchor(locale: string, amount: number): string {
  return `₳${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(amount)}`;
}

/** Podium colours: the top three ranks read as gold, silver and bronze. */
const RANK_COLOR: Record<number, string> = {
  1: "text-gold",
  2: "text-zinc-300",
  3: "text-orange-400",
};

/** Podium rows: the top three read as gold, silver and bronze. */
const PODIUM_STYLE: Record<number, string> = {
  1: "border-gold/40 bg-gold/10",
  2: "border-zinc-300/30 bg-zinc-300/5",
  3: "border-orange-400/30 bg-orange-400/5",
};

function scoreColor(score: number): string {
  return score > 0 ? "text-success" : score < 0 ? "text-error" : "text-muted";
}

function ContestRow({
  contest,
  t,
  locale,
  signedIn,
}: {
  contest: ContestCardData;
  t: T;
  locale: string;
  signedIn: boolean;
}) {
  const shares = prizeShares(contest.kind);
  const placed = contest.leaders.filter((s) => s.rank <= shares.length && s.score > 0);
  const rest = contest.leaders.filter((s) => !placed.includes(s));
  const leading = placed[0] ?? null;
  const viewer = contest.viewer;
  const gap = viewer && leading && viewer.rank > 1 ? leading.score - viewer.score : null;
  const showOwner = showsOwner(contest.kind);

  return (
    <details id={contest.kind} className="group border-t border-card-border first:border-t-0">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 hover:bg-background/40 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-90"
          aria-hidden
        />
        <span className="min-w-0 flex-1 basis-40 font-medium text-foreground">
          {t(`kinds.${contest.kind}.title`)}
        </span>
        <span className="order-last flex w-full min-w-0 items-center justify-between gap-3 pl-8 text-sm sm:order-none sm:w-72 sm:pl-0">
          {leading ? (
            <>
              <span className="min-w-0">
                <ContestEntry {...leading} showOwner={false} />
              </span>
              <span className={`shrink-0 tabular-nums ${scoreColor(leading.score)}`}>
                {formatScore(t, locale, contest.kind, leading.score)}
              </span>
            </>
          ) : (
            <span className="text-muted">{t("row.noLeader")}</span>
          )}
        </span>
        {viewer && (
          <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium tabular-nums text-primary">
            {viewer.rank === 1 && leading ? t("yours.leading") : `#${viewer.rank}`}
          </span>
        )}
        <span className="w-28 shrink-0 text-right font-semibold tabular-nums text-gold">
          {formatAnchor(locale, contest.prizeAnchor)}
        </span>
      </summary>

      <div className="px-4 pb-5 sm:pl-12">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <p className="max-w-2xl text-sm text-muted">{t(`kinds.${contest.kind}.rules`)}</p>
          <span className="text-xs text-muted">
            {shares.length === 1 ? t("split.winnerTakesAll") : t("split.podium")}
          </span>
        </div>

        {placed.length > 0 ? (
          <ol className="mt-4 space-y-1.5">
            {placed.map((s) => {
              const mine = viewer?.subjectId === s.subjectId;
              return (
                <li
                  key={s.subjectId}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${PODIUM_STYLE[s.rank] ?? ""} ${mine ? "ring-1 ring-primary" : ""}`}
                >
                  <span
                    className={`w-5 shrink-0 text-right text-lg font-bold tabular-nums ${RANK_COLOR[s.rank] ?? "text-muted"}`}
                  >
                    {s.rank}
                  </span>
                  <span className="min-w-0 flex-1">
                    <ContestEntry {...s} showOwner={showOwner} size={s.rank === 1 ? "lg" : "sm"} />
                  </span>
                  <span className="shrink-0 text-right">
                    <span className={`block font-semibold tabular-nums ${scoreColor(s.score)}`}>
                      {formatScore(t, locale, contest.kind, s.score)}
                    </span>
                    <span className="block text-xs tabular-nums text-gold">
                      {formatAnchor(locale, Math.round(contest.prizeAnchor * shares[s.rank - 1]))}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="mt-4 text-sm text-muted">{t("noLeaders")}</p>
        )}

        {rest.length > 0 && (
          <ol className="mt-2 text-sm">
            {rest.map((s) => {
              const mine = viewer?.subjectId === s.subjectId;
              return (
                <li
                  key={s.subjectId}
                  className={`-mx-2 flex items-center gap-3 rounded-md px-2 py-1.5 ${mine ? "bg-primary/10" : ""}`}
                >
                  <span className="w-5 shrink-0 text-right font-semibold tabular-nums text-muted">
                    {s.rank}
                  </span>
                  <span className="min-w-0 flex-1">
                    <ContestEntry {...s} showOwner={showOwner} />
                  </span>
                  <span className={`shrink-0 tabular-nums ${scoreColor(s.score)}`}>
                    {formatScore(t, locale, contest.kind, s.score)}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs">
          <span className={viewer ? "font-medium text-foreground" : "text-muted"}>
            {viewer
              ? viewer.rank === 1 && leading
                ? t("youLead")
                : gap !== null
                  ? `${t("yourStanding", { rank: viewer.rank, count: contest.entrants })} · ${gap > 0 ? t("gapBehind", { gap: formatGap(t, locale, contest.kind, gap) }) : t("tiedLead")}`
                  : t("yourStanding", { rank: viewer.rank, count: contest.entrants })
              : signedIn
                ? t("notEntered")
                : t("signInToTrack")}
          </span>
          <span className="text-muted">
            {t("entrants", { count: contest.entrants })}
            {contest.refreshedAt ? (
              <>
                {" "}
                · {t("updatedAt")} <LocalTime value={contest.refreshedAt} options={DATE_OPTIONS} />
              </>
            ) : null}
          </span>
        </div>
      </div>
    </details>
  );
}

/** The viewer's live entries, best placing first, each linking to its contest row. */
function YourStandings({
  contests,
  t,
  locale,
}: {
  contests: ContestCardData[];
  t: T;
  locale: string;
}) {
  const entered = contests
    .filter((c) => c.viewer)
    .sort((a, b) => a.viewer!.rank - b.viewer!.rank || a.kind.localeCompare(b.kind));
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
        {t("yours.title")}
      </h2>
      {entered.length === 0 ? (
        <p className="text-sm text-muted">{t("yours.none")}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {entered.map((c) => {
            const v = c.viewer!;
            const leading = v.rank === 1 && v.score > 0;
            return (
              <li key={c.kind}>
                <a
                  href={`#${c.kind}`}
                  className={`flex items-baseline gap-2 rounded-lg border px-3 py-2 text-sm hover:border-primary ${leading ? PODIUM_STYLE[1] : "border-card-border bg-card"}`}
                >
                  <span className="font-medium text-foreground">{t(`kinds.${c.kind}.title`)}</span>
                  <span
                    className={`tabular-nums ${leading ? "font-semibold text-gold" : "text-muted"}`}
                  >
                    {leading
                      ? t("yours.leading")
                      : t("yours.rank", { rank: v.rank, count: c.entrants })}
                  </span>
                  <span className={`text-xs tabular-nums ${scoreColor(v.score)}`}>
                    {formatScore(t, locale, c.kind, v.score)}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ReferralCard({
  board,
  t,
  userId,
}: {
  board: ReferralBoardData;
  t: T;
  userId: string | null;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-card-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">
            {t("kinds.referrals_iteration.title")}
          </h2>
          <p className="mt-1 text-sm text-muted">{t("kinds.referrals_iteration.rules")}</p>
        </div>
        <div className="max-w-[45%] shrink-0 text-right">
          <div className="text-xs text-muted">{t("prizeLabelTop3")}</div>
          <div className="text-sm font-bold text-gold">{t("iterationPrize")}</div>
        </div>
      </div>
      {!board.running ? (
        <p className="mt-4 text-sm text-muted">{t("referrals.notRunning")}</p>
      ) : (
        <>
          {board.startedAt && (
            <p className="mt-3 text-xs text-muted">
              {t("referrals.since")}{" "}
              <LocalTime
                value={board.startedAt}
                options={{ dateStyle: "medium" }}
                className="text-foreground"
              />
            </p>
          )}
          {board.leaders.length === 0 ? (
            <p className="mt-4 text-sm text-muted">{t("referrals.none")}</p>
          ) : (
            <ol className="mt-4 space-y-1.5 text-sm">
              {board.leaders.map((l) => (
                <li
                  key={l.rank}
                  className={`flex items-center justify-between gap-3 ${l.rank <= 3 ? `rounded-lg border px-3 py-1.5 ${PODIUM_STYLE[l.rank]}` : "px-3"}`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className={`inline-block w-5 shrink-0 text-right font-semibold tabular-nums ${RANK_COLOR[l.rank] ?? "text-muted"}`}
                    >
                      {l.rank}
                    </span>
                    <ContestEntry
                      subjectName={l.name || t("past.formerPlayer")}
                      characterName={l.name}
                      avatarUrl={l.avatarUrl}
                      characterHref={l.characterHref}
                      showOwner={false}
                    />
                  </span>
                  <span className="tabular-nums text-muted">
                    {t("scores.referrals", { count: l.count })}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {board.viewerCount !== null && (
            <p className="mt-4 text-xs text-foreground">
              {t("referrals.yourCount", { count: board.viewerCount })}
              {board.viewerRank !== null &&
                ` ${t("referrals.yourRank", { rank: board.viewerRank })}`}
            </p>
          )}
        </>
      )}
      {userId && (
        <ReferralInviteLink
          userId={userId}
          label={t("referrals.invite")}
          copyLabel={t("referrals.copy")}
          copiedLabel={t("referrals.copied")}
        />
      )}
    </section>
  );
}

function PastWinners({ past, t, locale }: { past: PastRoundData[]; t: T; locale: string }) {
  return (
    <section className="min-w-0 rounded-xl border border-card-border bg-card p-5">
      <h2 className="text-lg font-semibold text-foreground">{t("past.title")}</h2>
      {past.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{t("past.empty")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-card-border/60 text-sm">
          {past.map((round) => (
            <li key={round.id} className="py-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-foreground">
                  {round.kind === "referrals_iteration"
                    ? t("past.iterationTitle")
                    : t(`kinds.${round.kind}.title`)}{" "}
                  <span className="font-normal text-muted">
                    {t("past.round", { round: round.roundNumber })} ·{" "}
                    {formatIteration(round.iterationKey, t)}
                  </span>
                </span>
                <LocalTime
                  value={round.settledAt}
                  options={{ dateStyle: "medium" }}
                  className="text-xs text-muted"
                />
              </div>
              {round.winners.map((w) => (
                <div
                  key={`${round.id}-${w.rank ?? 1}`}
                  className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-muted"
                >
                  <span className="flex min-w-0 items-center gap-2 text-foreground">
                    <span
                      className={`w-4 shrink-0 text-right text-xs font-semibold tabular-nums ${RANK_COLOR[w.rank ?? 1] ?? "text-muted"}`}
                    >
                      {w.rank ?? 1}
                    </span>
                    <ContestEntry
                      {...w}
                      subjectName={w.subjectName || t("past.formerPlayer")}
                      showOwner={showsOwner(round.kind)}
                    />
                    <span className="shrink-0 text-muted">
                      {formatScore(t, locale, round.kind, w.score)}
                    </span>
                  </span>
                  <span className="text-xs font-medium text-gold">
                    {round.kind === "referrals_iteration"
                      ? w.alreadySupporter
                        ? t("past.alreadySupporter")
                        : t("past.supporter")
                      : w.prizeAnchor
                        ? t("past.prize", { prize: formatAnchor(locale, w.prizeAnchor) })
                        : null}
                  </span>
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PersonalResults({
  history,
  t,
  locale,
  kind,
  iterationKey,
}: {
  history: ContestHistoryData;
  t: T;
  locale: string;
  kind?: ContestRecordKind;
  iterationKey?: string;
}) {
  const totals = history.totals.reduce(
    (sum, row) => ({
      rounds: sum.rounds + row.rounds,
      wins: sum.wins + row.wins,
      podiums: sum.podiums + row.podiums,
      prizeAnchor: sum.prizeAnchor + row.prizeAnchor,
    }),
    { rounds: 0, wins: 0, podiums: 0, prizeAnchor: 0 }
  );
  const pageHref = (page: number) => {
    const params = new URLSearchParams({ view: "results", page: String(page) });
    if (kind) params.set("kind", kind);
    if (iterationKey) params.set("iteration", iterationKey);
    return `/contests?${params}`;
  };
  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">{t("history.title")}</h2>
        <p className="mt-2 text-sm text-muted">{t("history.intro")}</p>
      </div>
      <dl className="grid grid-cols-2 gap-6 border-y border-card-border py-6 sm:grid-cols-4">
        {(
          [
            ["rounds", totals.rounds],
            ["wins", totals.wins],
            ["podiums", totals.podiums],
            ["prizes", formatAnchor(locale, totals.prizeAnchor)],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm text-muted">{t(`history.${label}`)}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {history.totals.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="mb-3 text-left font-semibold">{t("history.allTime")}</caption>
            <thead>
              <tr>
                {["contest", "rounds", "wins", "podiums", "bestRank", "prizes"].map((key) => (
                  <th key={key} className="px-3 py-2">
                    {t(`history.${key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.totals.map((row) => (
                <tr key={row.kind} className="border-t border-card-border">
                  <td className="px-3 py-3">{t(`kinds.${row.kind}.title`)}</td>
                  <td className="px-3">{row.rounds}</td>
                  <td className="px-3">{row.wins}</td>
                  <td className="px-3">{row.podiums}</td>
                  <td className="px-3">#{row.bestRank}</td>
                  <td className="px-3">{formatAnchor(locale, row.prizeAnchor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form action="/contests" method="get" className="flex flex-wrap items-end gap-4">
        <input type="hidden" name="view" value="results" />
        <label className="text-sm">
          {t("history.contest")}
          <select
            name="kind"
            defaultValue={kind ?? ""}
            className="ml-2 rounded border border-card-border bg-card px-3 py-2"
          >
            <option value="">{t("history.allContests")}</option>
            {[...CONTEST_KINDS, "referrals_iteration" as const].map((k) => (
              <option key={k} value={k}>
                {t(`kinds.${k}.title`)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          {t("history.iteration")}
          <select
            name="iteration"
            defaultValue={iterationKey ?? ""}
            className="ml-2 rounded border border-card-border bg-card px-3 py-2"
          >
            <option value="">{t("history.allIterations")}</option>
            {history.iterations.map((iteration) => (
              <option key={iteration} value={iteration}>
                {formatIteration(iteration, t)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded bg-primary px-4 py-2 text-sm text-white">
          {t("history.filter")}
        </button>
      </form>
      {history.entries.length === 0 ? (
        <p className="py-6 text-muted">{t("history.empty")}</p>
      ) : (
        <ol className="divide-y divide-card-border">
          {history.entries.map((row) => (
            <li key={row.id} className="flex flex-wrap justify-between gap-4 py-5">
              <div>
                <h3 className="font-medium">
                  {t(`kinds.${row.kind}.title`)} · {t("past.round", { round: row.roundNumber })}
                </h3>
                <p className="mt-1 text-sm text-muted">
                  {formatIteration(row.iterationKey, t)} ·{" "}
                  <LocalTime value={row.settledAt} options={{ dateStyle: "medium" }} />
                </p>
                <p className="mt-2 text-sm">
                  {row.subjectName}
                  {showsOwner(row.kind) ? ` · ${row.characterName}` : ""}
                </p>
              </div>
              <div className="text-right">
                <p className="font-semibold">
                  {t("history.placing", { rank: row.rank, count: row.entrants })}
                </p>
                <p className="mt-1 text-sm tabular-nums">
                  {formatScore(t, locale, row.kind, row.score)}
                </p>
                <p className="mt-1 text-sm text-gold">
                  {row.supporter
                    ? row.alreadySupporter
                      ? t("past.alreadySupporter")
                      : t("past.supporter")
                    : row.prizeAnchor > 0
                      ? formatAnchor(locale, row.prizeAnchor)
                      : row.placed
                        ? t("history.placed")
                        : t("history.noPrize")}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
      <nav className="flex items-center gap-6 text-sm" aria-label={t("history.pages")}>
        {history.page > 1 && <Link href={pageHref(history.page - 1)}>{t("history.previous")}</Link>}
        <span className="text-muted">
          {t("history.page", {
            page: history.page,
            pages: Math.max(1, Math.ceil(history.count / HISTORY_PAGE_SIZE)),
          })}
        </span>
        {history.page * HISTORY_PAGE_SIZE < history.count && (
          <Link href={pageHref(history.page + 1)}>{t("history.next")}</Link>
        )}
      </nav>
    </section>
  );
}

function ContestChampions({
  champions,
  t,
  locale,
}: {
  champions: ContestChampion[];
  t: T;
  locale: string;
}) {
  return (
    <section>
      <h2 className="text-2xl font-semibold">{t("champions.title")}</h2>
      <p className="mb-4 mt-2 text-sm text-muted">{t("champions.intro")}</p>
      {champions.length === 0 ? (
        <p className="text-muted">{t("past.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className="px-3 py-2">#</th>
                {["player", "wins", "podiums", "rounds", "prizes"].map((key) => (
                  <th key={key} className="px-3 py-2">
                    {t(`history.${key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {champions.map((row, index) => (
                <tr key={index} className="border-t border-card-border">
                  <td className="px-3 py-3">{index + 1}</td>
                  <td className="px-3">{row.characterName}</td>
                  <td className="px-3">{row.wins}</td>
                  <td className="px-3">{row.podiums}</td>
                  <td className="px-3">{row.rounds}</td>
                  <td className="px-3">{formatAnchor(locale, row.prizeAnchor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default async function ContestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const view =
    params.view === "results" ? "results" : params.view === "rankings" ? "rankings" : "current";
  const scope = params.scope === "current" ? "current" : "all";
  const rankBy = params.rankBy === "netWorth" ? "netWorth" : "legacy";
  const kinds: readonly ContestRecordKind[] = [...CONTEST_KINDS, "referrals_iteration"];
  const kind =
    typeof params.kind === "string" && kinds.includes(params.kind as ContestRecordKind)
      ? (params.kind as ContestRecordKind)
      : undefined;
  const iterationKey =
    typeof params.iteration === "string" ? params.iteration.slice(0, 100) : undefined;
  const page = typeof params.page === "string" ? Number(params.page) : 1;
  const [t, locale, auth] = await Promise.all([
    getTranslations("contests"),
    getLocale(),
    getAuthUserWithCharacter(),
  ]);
  const db = await getDb();
  // Contests are a multiplayer feature; a fresh world opens its rounds on the first visit.
  if (!isSingleplayer()) await ensureContestsOpen(db);
  const data = await loadContestsPage(
    db,
    auth ? { userId: auth.userId, characterId: auth.character?._id.toString() ?? null } : null
  );
  const viewer = auth
    ? { userId: auth.userId, characterId: auth.character?._id.toString() ?? null }
    : null;
  const [history, champions, career] = await Promise.all([
    view === "results" && viewer
      ? loadContestHistory(db, viewer, page, { kind, iterationKey })
      : null,
    view === "rankings" ? loadContestChampions(db) : [],
    view === "rankings" ? getLegacyLeaderboardData(db, viewer, { scope, rankBy }) : null,
  ]);
  const leaderboardNames = new Map(
    career?.entries.map((entry) => [entry.userId, entry.displayName] as const) ?? []
  );
  const weekly = data.contests.filter((c) => c.kind !== "referrals_weekly");
  const categories = (["business", "politics", "government"] as const)
    .map(
      (category) => [category, weekly.filter((c) => CONTEST_CATEGORY[c.kind] === category)] as const
    )
    .filter(([, contests]) => contests.length > 0);
  const weeklyReferrals = data.contests.find((c) => c.kind === "referrals_weekly");
  // Weekly rounds open together, so any one of them carries the week's clock.
  const round = data.contests[0] ?? null;
  const pool = data.contests.reduce((sum, c) => sum + c.prizeAnchor, 0);

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <header className="mb-10 flex flex-col gap-6 rounded-2xl border border-card-border bg-card px-6 py-7 md:flex-row md:items-end md:justify-between md:px-8">
          <div className="max-w-xl">
            <h1 className="text-4xl font-bold tracking-tight text-foreground">{t("title")}</h1>
            <p className="mt-3 text-sm text-muted">
              {view === "rankings" ? t("career.intro") : t("intro")}
            </p>
          </div>
          {round && view !== "rankings" && (
            <div className="w-full md:w-80">
              <div className="text-sm text-muted">{t("poolLabel")}</div>
              <div className="text-4xl font-bold tabular-nums text-gold">
                {formatAnchor(locale, pool)}
              </div>
              <div className="mt-4">
                <RoundCountdown
                  startedAt={round.startedAt}
                  endsAt={round.endsAt}
                  round={round.roundNumber}
                  serverNow={data.loadedAt}
                />
              </div>
            </div>
          )}
        </header>

        <nav
          className="mb-8 flex flex-wrap gap-6 border-b border-card-border"
          aria-label={t("navigation")}
        >
          {(["current", "rankings"] as const).map((tab) => {
            const selected = tab === "rankings" ? view === "rankings" : view !== "rankings";
            return (
              <Link
                key={tab}
                href={`/contests?view=${tab}`}
                aria-current={selected ? "page" : undefined}
                className={`border-b-2 pb-3 font-medium ${selected ? "border-primary text-foreground" : "border-transparent text-muted hover:text-foreground"}`}
              >
                {tab === "current" ? t("tabs.contests") : t("tabs.rankings")}
              </Link>
            );
          })}
        </nav>
        {view !== "rankings" && (
          <nav className="mb-6 flex gap-2 text-sm" aria-label={t("contestViews")}>
            {(["current", "results"] as const).map((tab) => (
              <Link
                key={tab}
                href={`/contests?view=${tab}`}
                aria-current={view === tab ? "page" : undefined}
                className={`rounded-md px-4 py-2 ${view === tab ? "bg-card text-foreground" : "text-muted hover:text-foreground"}`}
              >
                {t(`tabs.${tab}`)}
              </Link>
            ))}
          </nav>
        )}
        {view === "results" &&
          (history ? (
            <PersonalResults
              history={history}
              t={t}
              locale={locale}
              kind={kind}
              iterationKey={iterationKey}
            />
          ) : (
            <p className="py-8 text-muted">{t("history.signIn")}</p>
          ))}
        {view === "rankings" && (
          <div className="space-y-10">
            <div>
              <h2 className="text-2xl font-semibold">{t("career.title")}</h2>
              <p className="mb-6 mt-2 text-sm text-muted">{t("career.intro")}</p>
              {career && (
                <LegacyLeaderboardClient
                  data={{ ...career, entries: career.entries.slice(0, 50) }}
                  total={career.total}
                  selfUserId={auth?.userId ?? null}
                  initialScope={scope}
                  initialRankBy={rankBy}
                  embedded
                />
              )}
            </div>
            <ContestChampions
              champions={champions.map((entry) => ({
                ...entry,
                characterName: leaderboardNames.get(entry.userId) ?? entry.characterName,
              }))}
              t={t}
              locale={locale}
            />
          </div>
        )}
        {view === "current" && (
          <>
            {auth && <YourStandings contests={data.contests} t={t} locale={locale} />}

            {weekly.length === 0 ? (
              <p className="mb-6 rounded-xl border border-dashed border-card-border p-6 text-sm text-muted">
                {t("noRound")}
              </p>
            ) : (
              <>
                <nav className="mb-6 flex flex-wrap gap-2 text-sm" aria-label={t("navigation")}>
                  {[...categories.map(([category]) => category), "referrals" as const].map(
                    (category) => (
                      <a
                        key={category}
                        href={`#category-${category}`}
                        className="rounded-full border border-card-border bg-card px-3 py-1 text-muted hover:text-foreground"
                      >
                        {t(`categories.${category}.title`)}
                      </a>
                    )
                  )}
                </nav>
                {categories.map(([category, contests]) => (
                  <section key={category} id={`category-${category}`} className="mb-8">
                    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4">
                      <h2 className="text-xl font-semibold text-foreground">
                        {t(`categories.${category}.title`)}
                      </h2>
                      <span className="text-sm text-muted">
                        {t(`categories.${category}.blurb`)} ·{" "}
                        {t("row.contests", { count: contests.length })}
                      </span>
                    </div>
                    <div className="overflow-hidden rounded-xl border border-card-border bg-card">
                      {contests.map((contest) => (
                        <ContestRow
                          key={contest.kind}
                          contest={contest}
                          t={t}
                          locale={locale}
                          signedIn={auth !== null}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </>
            )}

            <section id="category-referrals" className="mb-10">
              <h2 className="mb-1 text-xl font-semibold text-foreground">
                {t("referralsHeading")}
              </h2>
              <p className="mb-4 max-w-3xl text-sm text-muted">{t("referralIntro")}</p>
              <div className="space-y-4">
                {weeklyReferrals ? (
                  <div className="overflow-hidden rounded-xl border border-card-border bg-card">
                    <ContestRow
                      contest={weeklyReferrals}
                      t={t}
                      locale={locale}
                      signedIn={auth !== null}
                    />
                  </div>
                ) : (
                  <p className="rounded-xl border border-dashed border-card-border p-6 text-sm text-muted">
                    {t("noRound")}
                  </p>
                )}
                <ReferralCard board={data.referrals} t={t} userId={auth?.userId ?? null} />
              </div>
            </section>

            <PastWinners past={data.past} t={t} locale={locale} />
          </>
        )}
      </div>
    </div>
  );
}

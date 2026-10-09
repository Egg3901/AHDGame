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
import { prizeShares } from "@/lib/contests/rules";
import { ContestEntry } from "./ContestEntry";
import { ReferralInviteLink } from "./ReferralInviteLink";
import { RoundCountdown } from "./RoundCountdown";

export const metadata: Metadata = publicPageMetadata({
  title: "Contests | A House Divided",
  description:
    "Weekly contests for business and personal wealth growth, National Influence, government approval, legislation and party growth, plus the referral leaderboard.",
  pathname: "/contests",
});

export const dynamic = "force-dynamic";

type T = Awaited<ReturnType<typeof getTranslations<"contests">>>;

const DATE_OPTIONS: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };

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
  const whole = kind === "influence_gain" || kind === "party_growth";
  const value = new Intl.NumberFormat(locale, {
    maximumFractionDigits: whole ? 0 : 1,
    ...(signed ? { signDisplay: "exceptZero" as const } : {}),
  }).format(amount);
  if (kind === "influence_gain") return t("scores.influence", { value });
  if (kind === "approval_gain") return t("scores.approval", { value });
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
    kind === "approval_gain" ||
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

function ContestCard({
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
    <section className="flex min-w-0 flex-col rounded-xl border border-card-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">
            {t(`kinds.${contest.kind}.title`)}
          </h2>
          <p className="mt-1 text-sm text-muted">{t(`kinds.${contest.kind}.rules`)}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xs text-muted">{t("prizeLabel")}</div>
          <div className="text-lg font-bold tabular-nums text-gold">
            {formatAnchor(locale, contest.prizeAnchor)}
          </div>
          <div className="text-xs text-muted">
            {shares.length === 1 ? t("split.winnerTakesAll") : t("split.podium")}
          </div>
        </div>
      </div>

      {placed.length > 0 ? (
        <ol className="mt-4 space-y-1.5 border-b border-card-border pb-4">
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
        <p className="mt-5 border-b border-card-border pb-4 text-sm text-muted">{t("noLeaders")}</p>
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

      <div className="mt-auto flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pt-4 text-xs">
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
          {t("entrants", { count: contest.entrants })} ·{" "}
          {t("endsAt", { round: contest.roundNumber })}{" "}
          <LocalTime value={contest.endsAt} options={DATE_OPTIONS} />
        </span>
      </div>
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
                    {t("past.round", { round: round.roundNumber })}
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

export default async function ContestsPage() {
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
  const weekly = data.contests.filter((c) => c.kind !== "referrals_weekly");
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
            <p className="mt-3 text-sm text-muted">{t("intro")}</p>
          </div>
          {round && (
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

        {weekly.length === 0 ? (
          <p className="mb-6 rounded-xl border border-dashed border-card-border p-6 text-sm text-muted">
            {t("noRound")}
          </p>
        ) : (
          <div className="mb-10 grid gap-4 md:grid-cols-2">
            {weekly.map((contest) => (
              <ContestCard
                key={contest.kind}
                contest={contest}
                t={t}
                locale={locale}
                signedIn={auth !== null}
              />
            ))}
          </div>
        )}

        <h2 className="mb-1 text-xl font-semibold text-foreground">{t("referralsHeading")}</h2>
        <p className="mb-4 max-w-3xl text-sm text-muted">{t("referralIntro")}</p>
        <div className="mb-10 grid gap-4 md:grid-cols-2">
          {weeklyReferrals ? (
            <ContestCard contest={weeklyReferrals} t={t} locale={locale} signedIn={auth !== null} />
          ) : (
            <p className="rounded-xl border border-dashed border-card-border p-6 text-sm text-muted">
              {t("noRound")}
            </p>
          )}
          <ReferralCard board={data.referrals} t={t} userId={auth?.userId ?? null} />
        </div>

        <PastWinners past={data.past} t={t} locale={locale} />
      </div>
    </div>
  );
}

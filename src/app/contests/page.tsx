import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { getDb } from "@/lib/mongodb";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { publicPageMetadata } from "@/lib/siteMetadata";
import { LocalTime } from "@/components/time/LocalTime";
import type { ContestRecordKind, ContestStanding } from "@/lib/db/types/contestRound";
import {
  loadContestsPage,
  type ContestCardData,
  type PastRoundData,
  type ReferralBoardData,
} from "@/lib/contests/queries";
import { ReferralInviteLink } from "./ReferralInviteLink";

export const metadata: Metadata = publicPageMetadata({
  title: "Contests | A House Divided",
  description:
    "Weekly contests for corporate growth, National Influence and government approval, plus the referral leaderboard.",
  pathname: "/contests",
});

export const dynamic = "force-dynamic";

type T = Awaited<ReturnType<typeof getTranslations<"contests">>>;

const DATE_OPTIONS: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };

function formatScore(t: T, locale: string, kind: ContestRecordKind, score: number): string {
  if (kind === "referrals_weekly" || kind === "referrals_iteration") {
    return t("scores.referrals", { count: score });
  }
  const value = new Intl.NumberFormat(locale, {
    maximumFractionDigits: kind === "influence_gain" ? 0 : 1,
    signDisplay: "exceptZero",
  }).format(score);
  if (kind === "influence_gain") return t("scores.influence", { value });
  if (kind === "approval_gain") return t("scores.approval", { value });
  return t("scores.percent", { value });
}

function formatAnchor(locale: string, amount: number): string {
  return `₳${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(amount)}`;
}

function entryLabel(
  kind: ContestRecordKind,
  s: Pick<ContestStanding, "subjectName" | "characterName">
) {
  // Character entries are the character; corporate and government entries name their player.
  return kind === "influence_gain" || kind === "referrals_weekly"
    ? s.subjectName
    : `${s.subjectName} · ${s.characterName}`;
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
  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-card-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            {t(`kinds.${contest.kind}.title`)}
          </h2>
          <p className="mt-1 text-sm text-muted">{t(`kinds.${contest.kind}.rules`)}</p>
        </div>
        <span className="shrink-0 rounded-full border border-card-border px-2.5 py-0.5 text-xs text-muted">
          {t("entrants", { count: contest.entrants })}
        </span>
      </div>
      <p className="mt-3 text-sm font-medium text-foreground">
        {t("prize", { prize: formatAnchor(locale, contest.prizeAnchor) })}
      </p>
      <p className="mt-1 text-xs text-muted">
        {t("endsAt", { round: contest.roundNumber })}{" "}
        <LocalTime value={contest.endsAt} options={DATE_OPTIONS} className="text-foreground" />
      </p>

      {contest.leaders.length === 0 ? (
        <p className="mt-4 text-sm text-muted">{t("noLeaders")}</p>
      ) : (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-card-border text-left text-xs text-muted">
              <th className="w-8 py-1.5 font-medium">{t("rank")}</th>
              <th className="py-1.5 font-medium">{t("entry")}</th>
              <th className="py-1.5 text-right font-medium">{t("score")}</th>
            </tr>
          </thead>
          <tbody>
            {contest.leaders.map((s) => {
              const mine = contest.viewer?.subjectId === s.subjectId;
              return (
                <tr
                  key={s.subjectId}
                  className={`border-b border-card-border/50 last:border-0 ${mine ? "bg-primary/10" : ""}`}
                >
                  <td className="py-1.5 tabular-nums text-muted">{s.rank}</td>
                  <td className="py-1.5 pr-2 text-foreground">{entryLabel(contest.kind, s)}</td>
                  <td
                    className={`py-1.5 text-right tabular-nums ${s.score > 0 ? "text-success" : s.score < 0 ? "text-error" : "text-muted"}`}
                  >
                    {formatScore(t, locale, contest.kind, s.score)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <p className="mt-auto pt-4 text-xs text-muted">
        {contest.viewer ? (
          <span className="text-foreground">
            {t("yourStanding", { rank: contest.viewer.rank, count: contest.entrants })}:{" "}
            {formatScore(t, locale, contest.kind, contest.viewer.score)}
          </span>
        ) : signedIn ? (
          t("notEntered")
        ) : (
          t("signInToTrack")
        )}
      </p>
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
      <h2 className="text-lg font-semibold text-foreground">
        {t("kinds.referrals_iteration.title")}
      </h2>
      <p className="mt-1 text-sm text-muted">{t("kinds.referrals_iteration.rules")}</p>
      <p className="mt-3 text-sm font-medium text-foreground">{t("iterationPrize")}</p>
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
            <ol className="mt-4 space-y-1 text-sm">
              {board.leaders.map((l) => (
                <li key={l.rank} className="flex items-center justify-between gap-3">
                  <span className="text-foreground">
                    <span className="mr-2 inline-block w-6 tabular-nums text-muted">{l.rank}</span>
                    {l.name || t("past.formerPlayer")}
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
                  className="mt-1 flex flex-wrap items-baseline justify-between gap-2 text-muted"
                >
                  <span className="text-foreground">
                    {round.kind === "referrals_iteration"
                      ? `#${w.rank} ${w.subjectName || t("past.formerPlayer")}`
                      : entryLabel(round.kind, w)}{" "}
                    <span className="text-muted">
                      {formatScore(t, locale, round.kind, w.score)}
                    </span>
                  </span>
                  <span className="text-xs">
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
  const data = await loadContestsPage(
    db,
    auth ? { userId: auth.userId, characterId: auth.character?._id.toString() ?? null } : null
  );
  const weekly = data.contests.filter((c) => c.kind !== "referrals_weekly");
  const weeklyReferrals = data.contests.find((c) => c.kind === "referrals_weekly");

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted">{t("intro")}</p>
        </div>

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

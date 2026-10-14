"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { InlineError } from "@/components/ui/InlineError";
import { captureProductEvent } from "@/lib/analytics/capture";
import { apiErrorText } from "@/lib/errors/catalog";
import type { FirstDaysData } from "@/lib/onboarding/firstDays";

/**
 * "Your first days" panel on the profile of a new character.
 *
 * Three goals a player can act on the moment they arrive, in a world that is
 * already running: campaign (the only action that raises political
 * influence), join a party, and enter a race that is still open at home.
 * Shown whatever the player chose at the tutorial welcome.
 */
export function FirstDaysPanel({
  data,
  year,
  partiesHref,
}: {
  data: FirstDaysData;
  year: number | null;
  partiesHref: string;
}) {
  const t = useTranslations("profile.firstDays");
  const router = useRouter();
  const [campaigning, setCampaigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastGain, setLastGain] = useState<string | null>(null);
  const viewed = useRef(false);

  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    void captureProductEvent("first_days_viewed", {
      campaigns: data.campaigns,
      joined_party: data.joinedParty,
      entered_race: data.enteredRace,
      open_races: data.races.length,
    });
  }, [data]);

  const campaignDone = data.campaigns >= data.campaignGoal;

  async function campaign() {
    setCampaigning(true);
    setError(null);
    try {
      const res = await fetch("/api/actions/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionType: "campaign" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(apiErrorText(body, t("campaignFailed")));
        return;
      }
      setLastGain(typeof body.message === "string" ? body.message : null);
      void captureProductEvent("first_days_campaigned", { campaigns: data.campaigns + 1 });
      router.refresh();
    } catch {
      setError(t("campaignFailed"));
    } finally {
      setCampaigning(false);
    }
  }

  const step = (done: boolean, n: number) => (
    <span
      aria-hidden
      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-card-border text-body-xs font-semibold ${
        done ? "text-foreground" : "text-muted"
      }`}
    >
      {done ? "✓" : n}
    </span>
  );

  return (
    <section
      aria-label={t("aria")}
      className="rounded-md border border-primary/30 bg-primary/5"
      data-coach="first-days"
    >
      <div className="px-4 pt-3">
        <h2 className="text-heading-sm font-semibold text-foreground">
          {year ? t("titleYear", { year }) : t("title")}
        </h2>
        <p className="mt-0.5 text-body-xs text-muted">{t("intro")}</p>
      </div>

      <ol className="mt-2 divide-y divide-card-border/60">
        {/* 1. Campaign */}
        <li className="flex items-start gap-3 px-4 py-2.5">
          {step(campaignDone, 1)}
          <div className="min-w-0 flex-1">
            <p className="text-body-sm font-medium text-foreground">
              {t("campaignTitle", { done: data.campaigns, goal: data.campaignGoal })}
            </p>
            <p className="mt-0.5 text-body-xs leading-relaxed text-muted">
              {t("campaignBody", { influence: data.influence.toFixed(1) })}
            </p>
            {!campaignDone && (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <Button size="sm" onClick={campaign} isLoading={campaigning}>
                  {t("campaignButton")}
                </Button>
                <Link href="/actions" className="text-body-xs text-muted hover:underline">
                  {t("allActions")}
                </Link>
              </div>
            )}
            {lastGain && <p className="mt-1 text-body-xs text-success">{lastGain}</p>}
            <InlineError error={error} className="mt-1 text-body-xs text-error" />
          </div>
        </li>

        {/* 2. Party */}
        <li className="flex items-start gap-3 px-4 py-2.5">
          {step(data.joinedParty, 2)}
          <div className="min-w-0 flex-1">
            {data.joinedParty ? (
              <p className="text-body-sm text-muted">{t("partyDone")}</p>
            ) : (
              <>
                <Link
                  href={partiesHref}
                  className="text-body-sm font-medium text-foreground underline-offset-4 hover:underline"
                >
                  {t("partyTitle")} <span aria-hidden>→</span>
                </Link>
                <p className="mt-0.5 text-body-xs leading-relaxed text-muted">{t("partyBody")}</p>
              </>
            )}
          </div>
        </li>

        {/* 3. Race */}
        <li className="flex items-start gap-3 px-4 py-2.5">
          {step(data.enteredRace, 3)}
          <div className="min-w-0 flex-1">
            {data.enteredRace ? (
              <p className="text-body-sm text-muted">{t("raceDone")}</p>
            ) : (
              <>
                <p className="text-body-sm font-medium text-foreground">{t("raceTitle")}</p>
                {data.races.length === 0 ? (
                  <p className="mt-0.5 text-body-xs text-muted">{t("raceNone")}</p>
                ) : (
                  <>
                    <p className="mt-0.5 text-body-xs leading-relaxed text-muted">
                      {t("raceBody")}
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {data.races.map((race) => (
                        <li key={race.id} className="flex flex-wrap items-baseline gap-x-2">
                          <Link
                            href={`/elections/${race.id}`}
                            className="text-body-sm text-foreground underline-offset-4 hover:underline"
                          >
                            {race.label}
                          </Link>
                          <span className="text-body-xs text-muted">
                            {race.closesInHours === null
                              ? t("raceCandidates", { count: race.candidates })
                              : t("raceCloses", {
                                  hours: race.closesInHours,
                                  count: race.candidates,
                                })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </div>
        </li>
      </ol>

      {data.skippedTutorial && (
        <p className="border-t border-card-border/60 px-4 py-2 text-body-xs text-muted">
          {t.rich("skippedTour", {
            link: (chunks) => (
              <Link href="/tutorial" className="text-primary hover:underline">
                {chunks}
              </Link>
            ),
          })}
        </p>
      )}
    </section>
  );
}

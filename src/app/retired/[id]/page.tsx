"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import type { CountryId } from "@/lib/constants/countries";
import { getOfficeLabel } from "@/lib/utils/politics";
import { formatGameMonth, type GameDateAnchor } from "@/lib/utils/gameDate";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import { Skeleton } from "@/components/ui";
import { SeasonRecapStory } from "@/components/recap/SeasonRecapStory";
import type { CharacterRecap } from "@/lib/recap/types";
import { LocalTime } from "@/components/time/LocalTime";

interface RetiredCharacterResponse {
  gameDateAnchor: GameDateAnchor | null;
  retiredCharacter: {
    _id: string;
    retiredAt: string;
    reason: "player_deleted" | "game_reset" | "admin_action";
    snapshot: {
      name: string;
      countryId: string;
      homeState: string;
      party: string;
      partyName: string;
      currentOffice: { type: string; state?: string; seatsHeld?: number } | null;
      policies: { economic: number; social: number; domainPositions?: Record<string, number> };
      demographics?: {
        race: string;
        gender: string;
        education: string;
        wealth: string;
      };
      stats: {
        politicalInfluence: number;
        nationalInfluence?: number;
        favorability: number;
        infamy: number;
        funds: number;
        cashOnHand?: number;
      };
      avatarUrl?: string;
      profileHeaderImageUrl?: string;
      bio?: string;
      careerHistory?: {
        type: string;
        office?: { type: string; state?: string; seatsHeld?: number };
        officeLabel: string;
        party?: string;
        electionId?: string;
        fromState?: string;
        toState?: string;
        fromCountry?: string;
        toCountry?: string;
        date: string;
      }[];
      highestOffice?: string;
      achievementCount: number;
      createdAt: string;
    };
    recap?: CharacterRecap;
    iteration?: { type: string; number: number };
  };
}

const REASON_LABELS: Record<string, { label: string; color: string }> = {
  player_deleted: { label: "Retired", color: "bg-muted/20 text-muted border-muted/30" },
  game_reset: { label: "Game Reset", color: "bg-warning/15 text-warning border-warning/30" },
  admin_action: { label: "Admin Action", color: "bg-error/15 text-error border-error/30" },
};

const CAREER_EVENT_LABELS: Record<string, { label: string; color: string }> = {
  elected: { label: "Elected", color: "text-success" },
  lost_election: { label: "Lost Election", color: "text-error" },
  resigned: { label: "Resigned", color: "text-warning" },
  appointed: { label: "Appointed", color: "text-primary" },
  removed: { label: "Removed", color: "text-error" },
  relocated: { label: "Relocated", color: "text-primary" },
};

const RETIRED_DATE_OPTS: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
};

function getPolicyLabel(value: number): string {
  if (value <= -4) return "Far Left";
  if (value <= -2) return "Progressive";
  if (value < 0) return "Lean Left";
  if (value === 0) return "Centrist";
  if (value <= 2) return "Lean Right";
  if (value <= 4) return "Conservative";
  return "Far Right";
}

function getDemographicLabel(key: string, value: string): string {
  const labels: Record<string, Record<string, string>> = {
    race: { white: "White", black: "Black", hispanic: "Hispanic", asian: "Asian", other: "Other" },
    gender: { male: "Male", female: "Female", nonbinary: "Non-binary" },
    education: { no_college: "No College", college: "College", graduate: "Graduate" },
    wealth: { low: "Low Income", middle: "Middle Income", high: "High Income" },
  };
  return labels[key]?.[value] ?? value;
}

export default function RetiredCharacterProfilePage() {
  const params = useParams();
  const id = params.id as string;

  const [data, setData] = useState<RetiredCharacterResponse["retiredCharacter"] | null>(null);
  const [gameDateAnchor, setGameDateAnchor] = useState<GameDateAnchor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRecap, setShowRecap] = useState(false);

  useEffect(() => {
    fetch(`/api/settings/retired-characters/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.status === 404 ? "Character not found" : "Failed to load");
        return res.json();
      })
      .then((json: RetiredCharacterResponse) => {
        setData(json.retiredCharacter);
        setGameDateAnchor(json.gameDateAnchor);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
          <div className="min-h-96">
            <Skeleton className="mb-6 h-4 w-40" />
            <Skeleton className="mb-6 h-11 w-full rounded-lg" />
            <div className="mb-6 border-b border-card-border pb-4 space-y-2">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-5 w-80" />
              <Skeleton className="h-4 w-56" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background">
        <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
          <Link href="/settings" className="text-sm text-primary hover:underline">
            &larr; Back to Settings
          </Link>
          <div className="mt-8 rounded-xl border border-card-border bg-card-elevated/50 p-8 text-center">
            <p className="text-muted">{error ?? "Character not found"}</p>
          </div>
        </main>
      </div>
    );
  }

  const snap = data.snapshot;
  const countryId = snap.countryId as CountryId;
  const reasonInfo = REASON_LABELS[data.reason] ?? REASON_LABELS.player_deleted;
  const econ = snap.policies?.economic ?? 0;
  const social = snap.policies?.social ?? 0;

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8 overflow-x-hidden">
        {/* Navigation */}
        <nav className="mb-6 flex items-center gap-2 text-sm text-muted">
          <Link href="/settings" className="hover:text-foreground">
            Settings
          </Link>
          <span aria-hidden>/</span>
          <span className="text-foreground">{snap.name}</span>
        </nav>

        {/* Archived banner */}
        <div className="mb-6 rounded-lg border border-card-border bg-card-muted/30 px-4 py-3 text-sm text-muted">
          This is an archived character profile. All data shown is a snapshot from when the
          character was retired.
        </div>

        <div className="flex flex-col lg:flex-row lg:gap-8">
          {/* Main content */}
          <article className="flex-1 min-w-0">
            {/* Header */}
            <header className="mb-6 pb-4 border-b border-card-border">
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl font-bold text-foreground">{snap.name}</h1>
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${reasonInfo.color}`}
                >
                  {reasonInfo.label}
                </span>
              </div>
              <p className="text-lg text-muted">
                {getOfficeLabel(snap.currentOffice, countryId)} · {snap.partyName}
                {snap.homeState && ` · ${snap.homeState}, ${snap.countryId}`}
              </p>
              <p className="text-sm text-muted mt-1">
                Active:{" "}
                <LocalTime value={snap.createdAt} options={{ month: "short", year: "numeric" }} />{" "}
                &mdash;{" "}
                <LocalTime value={data.retiredAt} options={{ month: "short", year: "numeric" }} />
              </p>
              {data.recap && (
                <button
                  type="button"
                  onClick={() => setShowRecap(true)}
                  className="mt-3 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/20"
                >
                  ✨ Rewatch your Wrapped
                </button>
              )}
            </header>

            {/* Bio */}
            {snap.bio && (
              <section className="mb-8">
                <p className="text-[15px] leading-relaxed text-foreground">{snap.bio}</p>
              </section>
            )}

            {/* Highest Office */}
            {snap.highestOffice && (
              <section className="mb-8">
                <h2 className="text-xl font-semibold text-foreground mb-3 pb-2 border-b border-card-border">
                  Highest Office Held
                </h2>
                <p className="text-foreground">{snap.highestOffice}</p>
              </section>
            )}

            {/* Career History */}
            {snap.careerHistory && snap.careerHistory.length > 0 && (
              <section className="mb-8">
                <h2 className="text-xl font-semibold text-foreground mb-4 pb-2 border-b border-card-border">
                  Career History
                </h2>
                <div className="space-y-3">
                  {snap.careerHistory.map((event, idx) => {
                    const eventInfo = CAREER_EVENT_LABELS[event.type] ?? {
                      label: event.type,
                      color: "text-muted",
                    };
                    return (
                      <div
                        key={idx}
                        className="flex items-start gap-3 rounded-lg border border-card-border/50 bg-card/40 px-4 py-3"
                      >
                        <div className="shrink-0 mt-0.5">
                          <span className={`text-xs font-semibold ${eventInfo.color}`}>
                            {eventInfo.label}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            {event.type === "relocated"
                              ? `${event.fromState ?? "?"} → ${event.toState ?? "?"}${
                                  event.fromCountry &&
                                  event.toCountry &&
                                  event.fromCountry !== event.toCountry
                                    ? ` (${event.fromCountry} → ${event.toCountry})`
                                    : ""
                                }`
                              : event.office
                                ? getOfficeLabel(event.office, countryId)
                                : event.officeLabel}
                          </p>
                          <p className="text-xs text-muted mt-0.5">
                            {gameDateAnchor ? (
                              <>
                                {formatGameMonth(event.date, gameDateAnchor)} (
                                <LocalTime value={event.date} options={RETIRED_DATE_OPTS} />)
                              </>
                            ) : (
                              <LocalTime value={event.date} options={RETIRED_DATE_OPTS} />
                            )}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Political Positions */}
            {(econ !== 0 || social !== 0) && (
              <section className="mb-8">
                <h2 className="text-xl font-semibold text-foreground mb-4 pb-2 border-b border-card-border">
                  Political Positions
                </h2>
                <div className="space-y-4">
                  {/* Economic */}
                  <div>
                    <div className="flex items-center justify-between text-sm mb-1.5">
                      <span className="text-muted">Economic</span>
                      <span className="font-medium text-foreground">{getPolicyLabel(econ)}</span>
                    </div>
                    <div className="relative h-2 rounded-full bg-card-border">
                      <div
                        className="absolute top-0 h-full rounded-full bg-primary"
                        style={{
                          left: `${Math.min(((econ + 5) / 10) * 100, 50)}%`,
                          width: `${Math.abs(econ / 10) * 100}%`,
                          maxWidth: "50%",
                        }}
                      />
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-3 w-0.5 bg-muted/50" />
                    </div>
                    <div className="flex justify-between text-[10px] text-muted mt-0.5">
                      <span>Left</span>
                      <span>Right</span>
                    </div>
                  </div>
                  {/* Social */}
                  <div>
                    <div className="flex items-center justify-between text-sm mb-1.5">
                      <span className="text-muted">Social</span>
                      <span className="font-medium text-foreground">{getPolicyLabel(social)}</span>
                    </div>
                    <div className="relative h-2 rounded-full bg-card-border">
                      <div
                        className="absolute top-0 h-full rounded-full bg-primary"
                        style={{
                          left: `${Math.min(((social + 5) / 10) * 100, 50)}%`,
                          width: `${Math.abs(social / 10) * 100}%`,
                          maxWidth: "50%",
                        }}
                      />
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-3 w-0.5 bg-muted/50" />
                    </div>
                    <div className="flex justify-between text-[10px] text-muted mt-0.5">
                      <span>Liberal</span>
                      <span>Conservative</span>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* Demographics */}
            {snap.demographics && (
              <section className="mb-8">
                <h2 className="text-xl font-semibold text-foreground mb-4 pb-2 border-b border-card-border">
                  Background
                </h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {(["race", "gender", "education", "wealth"] as const).map((key) => {
                    const value = snap.demographics?.[key];
                    if (!value) return null;
                    return (
                      <div
                        key={key}
                        className="rounded-lg border border-card-border/50 bg-card/40 px-3 py-2"
                      >
                        <p className="text-[10px] uppercase tracking-wider text-muted">{key}</p>
                        <p className="text-sm font-medium text-foreground mt-0.5">
                          {getDemographicLabel(key, value)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </article>

          {/* Infobox sidebar */}
          <aside className="lg:w-72 shrink-0">
            <div className="lg:sticky lg:top-24 rounded-lg border border-card-border bg-card/60 overflow-hidden opacity-90">
              <div className="h-1 w-full bg-muted/40" />
              <div className="p-4">
                {/* Avatar */}
                <div className="flex justify-center mb-4">
                  <div className="relative h-32 w-32 rounded-lg overflow-hidden bg-gradient-to-br from-zinc-700 to-zinc-900 text-4xl font-bold flex items-center justify-center">
                    {snap.avatarUrl ? (
                      <Image
                        src={snap.avatarUrl}
                        alt={snap.name}
                        fill
                        className="object-cover grayscale-[30%]"
                        unoptimized={bypassNextImageOptimization(snap.avatarUrl)}
                      />
                    ) : (
                      <span className="text-muted">{snap.name.charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                </div>

                <table className="w-full text-sm">
                  <tbody>
                    <tr>
                      <td className="py-1.5 pr-2 align-top text-muted font-medium">Office</td>
                      <td className="py-1.5 text-foreground">
                        {getOfficeLabel(snap.currentOffice, countryId)}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5 pr-2 align-top text-muted font-medium">Party</td>
                      <td className="py-1.5 text-foreground">{snap.partyName}</td>
                    </tr>
                    <tr>
                      <td className="py-1.5 pr-2 align-top text-muted font-medium">State</td>
                      <td className="py-1.5 text-foreground">
                        {snap.homeState}, {snap.countryId}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5 pr-2 align-top text-muted font-medium">Influence</td>
                      <td className="py-1.5 text-foreground">
                        {snap.stats.politicalInfluence.toFixed(1)}%
                      </td>
                    </tr>
                    {snap.stats.nationalInfluence != null && (
                      <tr>
                        <td className="py-1.5 pr-2 align-top text-muted font-medium">National</td>
                        <td className="py-1.5 text-foreground">
                          {snap.stats.nationalInfluence.toFixed(1)}%
                        </td>
                      </tr>
                    )}
                    <tr>
                      <td className="py-1.5 pr-2 align-top text-muted font-medium">Favorability</td>
                      <td className="py-1.5 text-foreground">
                        {snap.stats.favorability.toFixed(1)}%
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5 pr-2 align-top text-muted font-medium">Infamy</td>
                      <td className="py-1.5 text-foreground">{snap.stats.infamy.toFixed(1)}%</td>
                    </tr>
                    <tr>
                      <td className="py-1.5 pr-2 align-top text-muted font-medium">Funds</td>
                      <td className="py-1.5 text-foreground">
                        ${snap.stats.funds.toLocaleString("en-US")}
                      </td>
                    </tr>
                    {snap.stats.cashOnHand != null && (
                      <tr>
                        <td className="py-1.5 pr-2 align-top text-muted font-medium">Cash</td>
                        <td className="py-1.5 text-foreground">
                          ${snap.stats.cashOnHand.toLocaleString("en-US")}
                        </td>
                      </tr>
                    )}
                    <tr>
                      <td className="py-1.5 pr-2 align-top text-muted font-medium">Achievements</td>
                      <td className="py-1.5 text-foreground">{snap.achievementCount}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </aside>
        </div>
      </main>
      {showRecap && data.recap && (
        <SeasonRecapStory recap={data.recap} onClose={() => setShowRecap(false)} />
      )}
    </div>
  );
}

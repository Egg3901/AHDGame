import Link from "next/link";
import {
  RESOLVE_SCRUTINY_RELIEF,
  RESOLVE_TURNS_REQUIRED,
  turnsUntilResolveRelief,
} from "@/lib/centralBank/credibility";
import { Avatar } from "@/components/Avatar";
import { InfoTooltip } from "@/components/InfoTooltip";
import { ChairAppointmentActions } from "./ChairAppointmentActions";
import type { ChairData } from "./centralBankTypes";

export function ChairCard({
  chairTitle,
  chair,
  chairAppointedAt,
  chairInfamy,
  resolveStreak,
  chairTermExpiresAtTurn,
  currentTurn,
  currentInflation,
  targetInflation,
  latestGdp,
  chairSelectionPending,
  chairMode,
  viewerIsChairNominee = false,
  countryCode = "",
}: {
  chairTitle: string;
  chair: ChairData | null;
  chairAppointedAt: string | null;
  chairInfamy: number;
  chairTermExpiresAtTurn: number | null;
  currentTurn: number;
  currentInflation: number;
  targetInflation: number;
  latestGdp: number;
  chairSelectionPending?: {
    characterId: string;
    characterName: string;
    pool: "political" | "economic";
    proposedAt: string;
    proposedAtTurn?: number | null;
    acceptanceTurnsRemaining?: number | null;
  } | null;
  chairMode?: "character" | "npp";
  /** True when the signed-in character is the pending nominee (ticket #1072). */
  viewerIsChairNominee?: boolean;
  countryCode?: string;
  /** Consecutive turns the corridor stance has been held. */
  resolveStreak?: number;
}) {
  const infamy = chairInfamy ?? 0;
  const streak = resolveStreak ?? 0;
  const stanceHeld = streak > 0;
  const resolveTurnsRemaining = turnsUntilResolveRelief(streak);
  const inflation = currentInflation ?? 0;
  const inflDelta = (inflation - targetInflation) * 0.5;
  const growthDelta = (2.0 - latestGdp) * 0.5;
  let rawDelta = inflDelta + growthDelta;
  if (rawDelta < 0) rawDelta *= Math.max(0.1, 1 - infamy / 150);
  const decay = -(infamy * 0.05);
  const netChange = decay + rawDelta;
  const colorClass = infamy > 25 ? "text-error" : infamy > 10 ? "text-warning" : "text-success";
  const barClass = infamy > 25 ? "bg-error" : infamy > 10 ? "bg-warning" : "bg-success";

  // A leftover NPP caretaker (chairMode still "npp" after persistPendingProposal
  // clears chairCharacterId) must not hide the pending offer. Ticket #1072 put
  // Accept/Decline on this vacant branch; ticket #1144 is the same offer with
  // the caretaker still rendered, so the nominee never saw the buttons.
  return (
    <div className="min-w-0 rounded-xl border border-card-border bg-card p-5">
      <h2 className="mb-3 break-words text-xs font-semibold uppercase tracking-widest text-muted">
        {chairTitle}
      </h2>

      {chairSelectionPending ? (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-center">
          <p className="text-sm text-foreground">
            Appointment pending for{" "}
            <Link
              href={`/character/${chairSelectionPending.characterId}`}
              className="font-medium text-primary hover:underline"
            >
              {chairSelectionPending.characterName}
            </Link>
          </p>
          <p className="mt-1 text-xs text-muted">
            {typeof chairSelectionPending.acceptanceTurnsRemaining === "number" ? (
              chairSelectionPending.acceptanceTurnsRemaining > 0 ? (
                <>
                  Awaiting acceptance ·{" "}
                  <span className="font-semibold text-foreground">
                    {chairSelectionPending.acceptanceTurnsRemaining}
                  </span>{" "}
                  {chairSelectionPending.acceptanceTurnsRemaining === 1 ? "turn" : "turns"} to
                  respond
                </>
              ) : (
                "Awaiting acceptance · lapses this turn"
              )
            ) : (
              "Awaiting acceptance"
            )}
          </p>
          {viewerIsChairNominee && <ChairAppointmentActions countryCode={countryCode} />}
        </div>
      ) : chair ? (
        chairMode === "npp" ? (
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
              <span className="text-sm font-semibold uppercase tracking-wider text-primary">
                AI
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <span className="block break-words text-sm font-semibold text-foreground">
                {chair.name}
              </span>
              <span className="mt-0.5 inline-block rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                Autonomous Chair (AI)
              </span>
              {chairAppointedAt && (
                <p className="mt-1 text-xs text-muted">
                  Appointed{" "}
                  {new Date(chairAppointedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href={`/character/${chair.sequentialId ?? chair.characterId}`}
              className="shrink-0"
            >
              <Avatar
                url={chair.avatarUrl}
                name={chair.name}
                size="h-12 w-12"
                borderKey={chair.borderKey}
                tintColor={chair.tintColor}
              />
            </Link>
            <div className="min-w-0 flex-1">
              <Link
                href={`/character/${chair.sequentialId ?? chair.characterId}`}
                className="block break-words text-sm font-semibold text-foreground hover:text-primary transition-colors"
              >
                {chair.name}
              </Link>
              {chair.partyName && (
                <p className="break-words text-xs text-muted">{chair.partyName}</p>
              )}
              {chairAppointedAt && (
                <p className="text-xs text-muted">
                  Appointed{" "}
                  {new Date(chairAppointedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              )}
            </div>
          </div>
        )
      ) : (
        <div className="rounded-lg border border-card-border/50 bg-card-muted p-4 text-center">
          <p className="text-sm text-muted">Position Vacant</p>
          <p className="mt-1 text-xs text-muted/60">Awaiting appointment</p>
        </div>
      )}

      {chair && !chairSelectionPending && (
        <div className="mt-3 space-y-2">
          {chairTermExpiresAtTurn != null ? (
            <>
              <p className="break-words text-xs text-muted">
                Term expires in{" "}
                <span className="font-semibold text-foreground">
                  {Math.max(0, chairTermExpiresAtTurn - currentTurn)} turns
                </span>{" "}
                <span className="whitespace-normal">
                  ({Math.max(0, ((chairTermExpiresAtTurn ?? 0) - currentTurn) / 48).toFixed(1)} game
                  years)
                </span>
              </p>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-background">
                <div
                  className="h-full rounded-full transition-all duration-500 bg-primary"
                  style={{
                    width: `${Math.min(100, Math.max(0, ((192 - Math.max(0, chairTermExpiresAtTurn - currentTurn)) / 192) * 100))}%`,
                  }}
                />
              </div>
            </>
          ) : (
            <p className="text-xs text-muted italic">No fixed term</p>
          )}
        </div>
      )}

      {chair && !chairSelectionPending && (
        <div className="mt-4 border-t border-card-border pt-4 space-y-2">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <InfoTooltip
              trigger={
                <span className="text-xs font-medium text-muted flex items-center gap-1 cursor-help">
                  Public Scrutiny
                  <svg
                    className="h-3 w-3 text-muted/60"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </span>
              }
            >
              <p className="text-muted">
                Measures public confidence in the chair&apos;s economic stewardship. High inflation
                and low GDP growth increase scrutiny; the inverse reduces it.
              </p>
              <p className="text-muted mt-1.5">
                Above 25, office benefits (actions &amp; national influence) are halved. Recovery
                becomes harder at high levels - positive effects are dampened.
              </p>
              <p className="text-muted mt-1.5">
                The trend shown below is the macro trend from inflation, growth, and natural decay.
                Aggressive rate cuts and failed FX intervention can add separate event scrutiny.
              </p>
            </InfoTooltip>
            <span className={`text-xs font-bold tabular-nums ${colorClass}`}>
              {infamy.toFixed(1)}
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-track overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${barClass}`}
              style={{ width: `${Math.min(100, infamy)}%` }}
            />
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[10px] font-medium text-muted">
            <span className="shrink-0">{infamy > 25 ? "Benefits halved" : "Normal benefits"}</span>
            <span
              className={`shrink-0 tabular-nums ${
                netChange > 0.01 ? "text-error" : netChange < -0.01 ? "text-success" : "text-muted"
              }`}
            >
              Macro {netChange > 0 ? "+" : ""}
              {netChange.toFixed(2)}/turn
            </span>
          </div>

          {/* The recovery path has to be visible: a hidden escape hatch is no
              escape hatch. Holding the stance the corridor calls for pays down
              scrutiny whether or not inflation has responded yet. */}
          <div className="mt-2 rounded-lg border border-card-border bg-card-elevated px-3 py-2 text-[11px] leading-snug text-muted">
            {resolveTurnsRemaining === 0 ? (
              <>
                Credibility restored this turn:{" "}
                <span className="font-semibold text-success">-{RESOLVE_SCRUTINY_RELIEF}</span>{" "}
                scrutiny for holding the stance the corridor called for.
              </>
            ) : stanceHeld ? (
              <>
                Hold this stance for{" "}
                <span className="font-semibold text-foreground">{resolveTurnsRemaining}</span> more
                turn{resolveTurnsRemaining === 1 ? "" : "s"} to cut{" "}
                <span className="font-semibold">{RESOLVE_SCRUTINY_RELIEF}</span> scrutiny, whether
                or not inflation has responded yet.
              </>
            ) : (
              <>
                Match the rate corridor and hold it for{" "}
                <span className="font-semibold text-foreground">{RESOLVE_TURNS_REQUIRED}</span>{" "}
                turns to cut <span className="font-semibold">{RESOLVE_SCRUTINY_RELIEF}</span>{" "}
                scrutiny. Resolve counts even before the numbers turn.
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

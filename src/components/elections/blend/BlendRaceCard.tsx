"use client";

/**
 * One race card in the "Blend" region display: broadcast chrome (phase chip,
 * dark card, share bar) wrapped around an editorial count (serif verdict
 * headline, standfirst, per-seat serif rows).
 *
 * The mockup is authored against this app's dark palette (#14141c / #1d1d2a /
 * #2a2a3d / #8f8f9d are the dark-theme values of `--background`, `--card`,
 * `--card-border`, `--muted`). Those are written as token classes here rather
 * than hex so the card survives the light and high-contrast themes; party
 * colors stay inline because they are per-party data, not theme.
 */

import Link from "next/link";
import type { EntryAction } from "@/lib/elections/entryEligibility";
import type {
  BlendCandidateRow,
  BlendRaceCard as BlendRaceCardModel,
} from "@/lib/elections/blendRegionViewModel";

interface BlendRaceCardProps {
  card: BlendRaceCardModel;
  /** Countdown for the card footer, e.g. "11h 03m". Null hides the value. */
  closesIn: string | null;
  /** True once the race is over, so the footer reads "Closed / Result certified". */
  closed: boolean;
  /**
   * Whether the viewer may file for or leave this race. The mockup card has no
   * entry affordance at all, but this is live gameplay the region page already
   * offers — dropping it to match the mockup would remove the only way to enter
   * a race from this tab.
   */
  entryAction: EntryAction;
  entryLoading: boolean;
  onEnterRace: (electionId: string) => void;
  onWithdraw: (electionId: string) => void;
}

/** Phase chip colors. Amber for a primary, green for a live or certified
 *  general, muted before filing closes. */
function chipClasses(phase: BlendRaceCardModel["phase"]): string {
  switch (phase) {
    case "primary":
      return "border-warning/60 text-warning";
    case "general":
    case "final":
      return "border-success/60 text-success";
    default:
      return "border-card-border text-muted";
  }
}

function chipBackground(phase: BlendRaceCardModel["phase"]): string {
  switch (phase) {
    case "primary":
      return "bg-warning/[0.08]";
    case "general":
    case "final":
      return "bg-success/[0.08]";
    default:
      return "bg-card-muted/40";
  }
}

function CandidateRow({
  row,
  showSeats,
  showDelta,
}: {
  row: BlendCandidateRow;
  showSeats: boolean;
  showDelta: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2 border-b border-dotted border-card-border/90 py-2.5">
      <span
        className="w-[3px] shrink-0 self-stretch rounded-sm"
        style={{ background: row.color }}
        aria-hidden
      />
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="min-w-0 truncate font-serif text-base text-foreground">
          {row.name}
          {row.isYou && <span className="text-muted"> (you)</span>}
        </span>
        {row.isWinner && (
          <span className="shrink-0 whitespace-nowrap rounded bg-warning/20 px-1.5 py-px text-[10px] font-bold tracking-wider text-warning">
            WINNER
          </span>
        )}
      </span>
      <span className="w-9 shrink-0 text-right text-[10px] font-extrabold tracking-widest text-muted">
        {row.partyAbbr}
      </span>
      <span
        className="w-14 shrink-0 text-right font-serif text-lg font-bold tabular-nums"
        style={{ color: row.color }}
      >
        {row.pctStr}%
      </span>
      {showSeats && (
        <span className="w-10 shrink-0 text-right font-serif text-[17px] font-bold tabular-nums text-foreground">
          {row.seatsCell}
        </span>
      )}
      {showDelta && (
        <span
          title="Change in vote share since the previous turn"
          className={`w-10 shrink-0 text-right text-[11px] tabular-nums ${
            row.deltaPts === null
              ? "text-muted/60"
              : row.deltaPts > 0
                ? "text-success"
                : row.deltaPts < 0
                  ? "text-error"
                  : "text-muted"
          }`}
        >
          {row.deltaStr}
        </span>
      )}
    </div>
  );
}

export function BlendRaceCard({
  card,
  closesIn,
  closed,
  entryAction,
  entryLoading,
  onEnterRace,
  onWithdraw,
}: BlendRaceCardProps) {
  // min-w-0 on the root: a grid track is minmax(auto, 1fr), so without it a long
  // candidate name would widen the column past the viewport on mobile.
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-card-border bg-card">
      {/* ── Chrome: phase chip, race title, what it awards ── */}
      <div
        className={`flex items-center gap-2.5 border-b border-card-border px-4 py-3 ${chipBackground(card.phase)}`}
      >
        <span
          className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.16em] ${chipClasses(card.phase)}`}
        >
          {card.callTag}
        </span>
        <span className="min-w-0 flex-1 truncate text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
          {card.title}
        </span>
        {card.seatLine && (
          <span className="shrink-0 text-[11px] font-bold tabular-nums text-muted">
            {card.seatLine}
          </span>
        )}
      </div>

      <div className="px-4 pb-4 pt-[18px]">
        {/* ── Editorial count: kicker, verdict, standfirst ── */}
        <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted">
          {card.kicker}
        </div>
        <h3 className="mt-1.5 font-serif text-2xl font-bold leading-[1.18] tracking-tight text-foreground">
          {card.verdict}
        </h3>
        <p className="mt-2.5 font-serif text-[15px] leading-relaxed text-muted">
          {card.standfirst}
        </p>

        {card.meta.length > 0 && (
          <div className="mt-4 flex flex-wrap items-baseline gap-x-[18px] gap-y-1.5 border-b border-card-border/80 pb-2.5">
            {card.meta.map((chip) => (
              <div key={chip.key} className="flex min-w-0 items-baseline gap-[7px]">
                <span className="whitespace-nowrap text-[9px] font-black uppercase tracking-[0.14em] text-muted">
                  {chip.key}
                </span>
                <span className="text-sm font-black tabular-nums text-foreground">
                  {chip.value}
                </span>
                {chip.sub && (
                  <span className="text-[10px] tabular-nums text-muted">{chip.sub}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Primary: each party's own field, normalized to that party ── */}
        {card.isPrimary && (
          <div className="mt-4 flex flex-col gap-4">
            {card.primaryGroups.map((group) => (
              <div key={group.partyId}>
                <div
                  className="mb-2 flex items-baseline gap-2 border-b pb-1.5"
                  style={{ borderColor: group.color }}
                >
                  <span
                    className="text-[10px] font-extrabold uppercase tracking-[0.18em]"
                    style={{ color: group.color }}
                  >
                    {group.label}
                  </span>
                  <div className="flex-1" />
                  {/* Ballots accrue only over the primary's closing window and
                      only where the region has registration data, so the count
                      appears where one genuinely exists. */}
                  {group.partyVotes > 0 && (
                    <span className="whitespace-nowrap text-[10px] tabular-nums text-muted">
                      {group.partyVotesStr} primary votes
                    </span>
                  )}
                </div>
                {group.candidates.map((row) => (
                  <div
                    key={row.candidateId}
                    className="flex items-baseline gap-2.5 border-b border-dotted border-card-border/90 py-[7px]"
                  >
                    <span
                      className="w-[3px] shrink-0 self-stretch rounded-sm"
                      style={{ background: row.color }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate font-serif text-base text-foreground">
                      {row.name}
                      {row.isYou && <span className="text-muted"> (you)</span>}
                    </span>
                    {row.votes > 0 && (
                      <span className="w-[76px] shrink-0 text-right text-[11px] tabular-nums text-muted">
                        {row.votesStr}
                      </span>
                    )}
                    <span
                      className="w-[66px] shrink-0 text-right font-serif text-[19px] font-bold tabular-nums"
                      style={{ color: row.color }}
                    >
                      {row.pctStr}%
                    </span>
                  </div>
                ))}
              </div>
            ))}
            <p className="text-[11px] italic leading-snug text-muted/70">
              Each figure is a share of that party&apos;s own primary vote, not of the regional
              total.
            </p>
          </div>
        )}

        {/* ── Before any ballots: the declared field ── */}
        {card.showSlate && (
          <div className="mt-4 flex flex-col gap-2.5">
            <div className="text-[9px] font-black uppercase tracking-[0.16em] text-muted">
              Declared candidates
            </div>
            {card.slate.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {card.slate.map((row) => (
                  <span
                    key={row.candidateId}
                    className="inline-flex items-center gap-[7px] whitespace-nowrap rounded-lg border border-card-border bg-background px-2.5 py-1.5"
                    style={{ borderLeft: `3px solid ${row.color}` }}
                  >
                    <span className="font-serif text-sm font-bold text-foreground">
                      {row.name}
                      {row.isYou && <span className="text-muted"> (you)</span>}
                    </span>
                    <span
                      className="text-[10px] font-extrabold tracking-wider"
                      style={{ color: row.color }}
                    >
                      {row.partyAbbr}
                    </span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-muted/70">No candidates have filed yet.</p>
            )}
            <div className="text-[11px] text-muted/70">Filing is open, no ballots cast yet.</div>
          </div>
        )}

        {/* ── The count: share bar, then the serif per-candidate rows ── */}
        {card.showTally && (
          <>
            {card.segments.length > 0 && (
              <div className="mt-1 flex h-[30px] overflow-hidden rounded-md border border-card-border">
                {card.segments.map((seg, i) => (
                  <div
                    key={`${seg.title}-${i}`}
                    title={seg.title}
                    className="flex items-center justify-center overflow-hidden text-[11px] font-black text-background"
                    style={{ width: `${seg.widthPct}%`, background: seg.color }}
                  >
                    {seg.label}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-0.5 flex items-baseline gap-2 border-b border-card-border px-0 pb-1.5 pt-3.5 text-[9px] uppercase tracking-[0.14em] text-muted">
              <span className="w-[3px] shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">Candidate</span>
              <span className="w-9 shrink-0 text-right">Party</span>
              <span className="w-14 shrink-0 text-right">Share</span>
              {card.showSeats && <span className="w-10 shrink-0 text-right">{card.seatLabel}</span>}
              {card.showDelta && (
                <span
                  title="Change in vote share since the previous turn"
                  className="w-10 shrink-0 text-right"
                >
                  &plusmn; Turn
                </span>
              )}
            </div>

            {card.rows.map((row) => (
              <CandidateRow
                key={row.candidateId}
                row={row}
                showSeats={card.showSeats}
                showDelta={card.showDelta}
              />
            ))}
          </>
        )}
      </div>

      {/* ── Footer: the clock, and the way through to the full count ── */}
      <div className="mt-auto flex items-center gap-2.5 border-t border-card-border bg-card-muted px-4 py-2.5">
        <span className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-muted">
          {closed ? "Closed" : "Closes"}
        </span>
        <span className={`text-xs font-semibold ${closed ? "text-success" : "text-warning"}`}>
          {closed ? "Result certified" : (closesIn ?? "—")}
        </span>
        <div className="flex-1" />
        {entryAction === "withdraw" && (
          <button
            type="button"
            onClick={() => onWithdraw(card.electionId)}
            disabled={entryLoading}
            className="rounded-md border border-error/50 bg-error/10 px-2.5 py-1 text-[11px] font-medium text-error transition-colors hover:bg-error/20 disabled:opacity-50"
          >
            {entryLoading ? "Processing..." : "Withdraw"}
          </button>
        )}
        {entryAction === "enter" && (
          <button
            type="button"
            onClick={() => onEnterRace(card.electionId)}
            disabled={entryLoading}
            className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
          >
            {entryLoading ? "Joining..." : "Enter race"}
          </button>
        )}
        <Link
          href={card.href}
          className="border-b border-primary pb-0.5 font-serif text-sm italic text-primary transition-colors hover:border-primary/60 hover:text-primary/80"
        >
          Read the full count &rarr;
        </Link>
      </div>
    </div>
  );
}

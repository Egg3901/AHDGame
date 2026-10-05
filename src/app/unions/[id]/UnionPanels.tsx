"use client";

import { Tooltip } from "@/components/ui";
import type { UnionDetail } from "./unionTypes";

export function StanceBadge({ stance }: { stance: "endorse" | "oppose" }) {
  return (
    <span
      className={`rounded-md px-2 py-0.5 text-xs font-medium ${
        stance === "endorse" ? "bg-success/15 text-success" : "bg-error/15 text-error"
      }`}
    >
      {stance === "endorse" ? "Endorsed" : "Opposed"}
    </span>
  );
}

/** Outcome of the last union action, success or the server's reason for refusing. */
/**
 * Success line for an underground drive response. Reports the gain and the
 * vague heat bracket, never exact heat (the server never sends it).
 */
export function describeUndergroundResult(data: {
  strengthGain?: unknown;
  heatText?: unknown;
  status?: unknown;
  crisisExtended?: unknown;
}): string {
  const gain = typeof data.strengthGain === "number" ? data.strengthGain : null;
  const heat =
    data.heatText === "cold" || data.heatText === "warm" || data.heatText === "hot"
      ? data.heatText
      : "warm";
  const base =
    gain != null
      ? `Cell work done: +${gain} underground strength. Running ${heat}.`
      : `Cell work done. Running ${heat}.`;
  const exposure =
    data.status === "exposed" ? " Exposed: gains run at half pace until the cell goes dark." : "";
  const resistance =
    data.crisisExtended === true ? " The wildcat strike gained one turn of resistance." : "";
  return `${base}${exposure}${resistance}`;
}

const UNDERGROUND_STATUS_COPY: Record<
  "dark" | "suspected" | "exposed",
  { label: string; toneClass: string }
> = {
  dark: { label: "Operating in the dark", toneClass: "text-muted" },
  suspected: { label: "Drawing attention", toneClass: "text-warning" },
  exposed: { label: "Exposed", toneClass: "text-error" },
};

const UNDERGROUND_HEAT_COPY: Record<"cold" | "warm" | "hot", string> = {
  cold: "Cold",
  warm: "Warm",
  hot: "Hot",
};

/**
 * The rank-and-file loop under a ban. Replaces the legal organize panel on
 * suspended unions: two drive modes (quiet cell work vs mass drive), a vague
 * heat readout, and the shadow pool that converts at half on repeal.
 */
export function UndergroundOrganizePanel({
  countryName,
  underground,
  currentTurn,
  myActions,
  actionPending,
  result,
  onDrive,
}: {
  countryName: string;
  underground: NonNullable<UnionDetail["underground"]>;
  currentTurn: number;
  myActions: number | null;
  actionPending: boolean;
  result: { ok: boolean; text: string } | null;
  onDrive: (mode: "quiet" | "mass") => void;
}) {
  const status = underground.status ? UNDERGROUND_STATUS_COPY[underground.status] : null;
  const exposed = underground.status === "exposed";
  const quietGain = exposed ? underground.quietGain / 2 : underground.quietGain;
  const massGain = exposed ? underground.massGain / 2 : underground.massGain;
  const cannotAfford = myActions != null && myActions < underground.actionCost;
  const actionsLoading = myActions == null;
  const exposedTurnsLeft =
    underground.status === "exposed" && underground.exposedUntilTurn != null
      ? Math.max(0, underground.exposedUntilTurn - currentTurn + 1)
      : 0;
  return (
    <section className="space-y-4 rounded-xl border border-card-border bg-card p-5">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold text-muted">Organize underground</h2>
        <div className="h-px flex-1 bg-card-border" />
      </div>

      <p className="text-sm text-muted">
        The ban froze this union&apos;s treasury and leadership, but the cells kept meeting. Anyone
        in {countryName} can run quiet cell work or a loud mass drive. Both build hidden strength
        that converts to legal strength at half if the ban is ever repealed. Noise brings attention:
        loud stretches get noticed, and an exposed cell builds at half pace. Strong mass drives can
        prolong a live wildcat crisis by one turn per drive.
      </p>

      <div className="flex flex-wrap gap-4 text-sm">
        <div>
          <span className="text-muted">Built underground:</span>{" "}
          <span className="font-semibold tabular-nums">
            {underground.strength == null
              ? "Hidden until you organize"
              : Math.round(underground.strength)}
          </span>
        </div>
        <div>
          <span className="text-muted">Status:</span>{" "}
          <span className={`font-semibold ${status?.toneClass ?? ""}`}>
            {status?.label ?? "Unknown"}
          </span>
          {exposedTurnsLeft > 0 && (
            <span className="text-muted"> · {exposedTurnsLeft} turns left</span>
          )}
        </div>
      </div>

      {/* Heat is vague by design: the server never sends the number, only the bracket. */}
      <div className="space-y-1">
        <div
          className="flex gap-1"
          role="img"
          aria-label={`Heat: ${underground.heatText ?? "unknown"}`}
        >
          {(Object.keys(UNDERGROUND_HEAT_COPY) as ("cold" | "warm" | "hot")[]).map((level) => {
            const active = underground.heatText === level;
            const tone =
              level === "cold"
                ? "border-success/30 bg-success/10 text-success"
                : level === "warm"
                  ? "border-warning/30 bg-warning/10 text-warning"
                  : "border-error/30 bg-error/10 text-error";
            return (
              <span
                key={level}
                className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                  active ? tone : "border-card-border bg-card-elevated text-muted"
                }`}
              >
                {UNDERGROUND_HEAT_COPY[level]}
              </span>
            );
          })}
        </div>
        <p className="text-[11px] text-muted">
          You never see the exact number. Quiet work and idle turns cool the trail.
        </p>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1">
          <button
            type="button"
            aria-describedby="underground-action-cost underground-quiet-effect"
            disabled={actionPending || actionsLoading || cannotAfford}
            onClick={() => onDrive("quiet")}
            className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-primary/90 active:scale-95 disabled:opacity-50"
          >
            Quiet cell work
          </button>
          <span id="underground-quiet-effect" className="text-[11px] text-muted">
            +{quietGain} strength · low heat{exposed && " · halved while exposed"}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <button
            type="button"
            aria-describedby="underground-action-cost underground-mass-effect"
            disabled={actionPending || actionsLoading || cannotAfford}
            onClick={() => onDrive("mass")}
            className="w-fit rounded-lg border border-card-border px-4 py-2 text-sm font-medium transition-colors hover:bg-card-elevated disabled:opacity-50"
          >
            Mass drive
          </button>
          <span id="underground-mass-effect" className="text-[11px] text-muted">
            +{massGain} strength · high heat
            {exposed && " · halved while exposed"}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <span id="underground-action-cost" className="text-[11px] text-muted">
          Costs {underground.actionCost} action points
          {actionsLoading ? " · checking your action points" : ` · you have ${myActions}`} · one
          drive per turn
        </span>
        {cannotAfford && (
          <span className="text-[11px] font-medium text-error">
            Not enough action points. They refresh each turn.
          </span>
        )}
      </div>

      <ActionResult result={result} />
    </section>
  );
}

export function ActionResult({ result }: { result: { ok: boolean; text: string } | null }) {
  if (!result) return null;
  return (
    <p
      // A refusal is an error, not a status update: screen readers should
      // interrupt for it rather than queue it behind whatever else is talking.
      role={result.ok ? "status" : "alert"}
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${
        result.ok
          ? "border-success/30 bg-success/10 text-success"
          : "border-error/30 bg-error/10 text-error"
      }`}
    >
      <span aria-hidden>{result.ok ? "✓" : "⚠"}</span>
      <span>{result.text}</span>
    </p>
  );
}

export function StatCell({
  label,
  value,
  hint,
  sub,
}: {
  label: string;
  value: string;
  hint?: string;
  /** Plain-language reading of the number, printed under it. */
  sub?: { label: string; toneClass: string };
}) {
  return (
    // Tooltip rather than a title attribute: native tooltips never fire on
    // touch, which is where these stats were being misread.
    <div className="flex min-w-max flex-col px-5 py-3">
      <span className="flex items-center text-[10px] font-medium uppercase tracking-widest text-muted">
        {label}
        {hint && <Tooltip content={hint} label={`What ${label} means`} />}
      </span>
      <span className="text-base font-bold tabular-nums">{value}</span>
      {sub && <span className={`text-[11px] font-medium ${sub.toneClass}`}>{sub.label}</span>}
    </div>
  );
}

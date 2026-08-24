import type { DossierBenchView, DossierView } from "@/lib/settlement/queries/dossier";

/**
 * A bloc's delegations, with what each has actually committed.
 *
 * `committedPoints` and the bar are live totals off the crisis document — the
 * source mockup hardcoded both as literal ternaries.
 */
export function DelegationBench({
  title,
  bloc,
  seats,
}: {
  title: string;
  bloc: "west" | "east";
  seats: DossierBenchView[];
}) {
  const accent = bloc === "east" ? "text-error" : "text-info";
  const frame =
    bloc === "east" ? "border-error/30 bg-error/[0.04]" : "border-info/30 bg-info/[0.04]";
  const rule = bloc === "east" ? "border-error/20" : "border-info/20";
  const fill = bloc === "east" ? "from-primary-dark to-error-muted" : "from-secondary to-info";

  return (
    <section aria-label={title} className={`rounded-xl border p-4 ${frame}`}>
      <h2 className={`mb-3 font-mono text-body-xs font-bold tracking-wider ${accent}`}>{title}</h2>
      <div className="flex flex-col gap-2.5">
        {seats.map((seat) => (
          <div
            key={seat.seatId}
            data-testid={`delegation-seat-${seat.seatId}`}
            className={`flex flex-col gap-1.5 border-b border-dashed pb-2.5 ${rule}`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-body-sm font-semibold text-foreground">{seat.name}</span>
              <span className={`font-mono text-body-sm font-bold ${accent}`}>
                {seat.committedPoints.toFixed(1)} pts
              </span>
            </div>
            <div className="font-mono text-body-xs tracking-wide text-muted">
              {seat.tier} · {seat.multiplier} ·{" "}
              {seat.isViewer ? "your seat" : seat.actedThisTurn ? "acted this turn" : "quiet"}
            </div>
            {/*
              Both offices, always — an unheld one is the fact that this
              delegation has nobody who can act, which is worth as much to the
              reader as a name would be.
            */}
            {/*
              Stacked, not side by side. "Minister of Foreign Affairs" is 27
              characters and a name runs to 30; sharing one line in this column
              clipped BOTH halves to "Minister of Fo… Cecelia …". Each gets the
              full width of the card instead, so the title reads whole on its
              own line with the holder beneath it.
            */}
            <dl className="flex flex-col gap-1 font-mono text-body-xs">
              {seat.offices.map((office) => (
                <div key={office.role}>
                  <dt className="truncate text-muted">{office.title}</dt>
                  <dd className="truncate text-foreground">{office.holder ?? "vacant"}</dd>
                </div>
              ))}
            </dl>
            <div className="relative h-1.5 overflow-hidden rounded border border-card-border bg-background">
              <div
                className={`absolute inset-y-0 left-0 bg-gradient-to-r ${fill}`}
                style={{ width: `${seat.barPct}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * The open floor: every character holds one 0.25× play of each kind per turn.
 *
 * The count and the net are this turn's real personal plays, projected before
 * the turn resolves. When the ceiling bites, the panel says so: a silent
 * throttle would read as "the public barely turned out" when in fact thousands
 * did and were scaled down.
 *
 * The ceiling itself is sized by turnout, so it is quoted as this turn's rather
 * than as a standing rule.
 */
export function OpenFloorPanel({ openFloor }: { openFloor: DossierView["openFloor"] }) {
  return (
    <section className="rounded-xl border border-success/20 bg-success/[0.03] p-4">
      <h2 className="mb-2 font-mono text-body-xs font-bold tracking-wider text-success">
        ✎ THE OPEN FLOOR
      </h2>
      <p className="font-mono text-body-xs leading-relaxed text-muted">
        Every character in the world holds one 0.25× play of each kind, per turn, on the street and
        the Bundestag. {openFloor.characters.toLocaleString()}{" "}
        {openFloor.characters === 1 ? "character has" : "characters have"} taken a position this
        turn, for a net {openFloor.netPoints >= 0 ? "+" : ""}
        {/* Two decimals, matching the institution cards and the wire: at the
            tuned tempo a small crowd's whole ceiling is under one point, and
            one decimal rounded it away from what the cards quote. */}
        {openFloor.netPoints.toFixed(2)} toward{" "}
        {openFloor.netPoints >= 0 ? "reunification" : "NATO"}.
      </p>
      {/*
        The ceiling moves with turnout now, so it is stated as this turn's
        rather than as a standing rule, and the scaling is future tense because
        it happens when the turn resolves.
      */}
      {openFloor.capped && (
        <p className="mt-2 font-mono text-body-xs leading-relaxed text-warning">
          The floor asked for {openFloor.rawPoints >= 0 ? "+" : ""}
          {openFloor.rawPoints.toFixed(2)} and will be scaled to{" "}
          {openFloor.netPoints >= 0 ? "+" : ""}
          {openFloor.netPoints.toFixed(2)}: with {openFloor.characters.toLocaleString()} taking
          part, the floor can move one institution by at most ±{openFloor.capPoints.toFixed(2)} this
          turn. A larger turnout raises that ceiling.
        </p>
      )}
    </section>
  );
}

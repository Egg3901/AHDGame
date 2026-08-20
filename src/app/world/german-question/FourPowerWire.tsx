import type { DossierWireLine } from "@/lib/settlement/queries/dossier";

const BLOC_TONE: Record<DossierWireLine["bloc"], string> = {
  east: "text-error",
  west: "text-info",
  open: "text-success",
  bonn: "text-gold",
};

const BLOC_RULE: Record<DossierWireLine["bloc"], string> = {
  east: "bg-error",
  west: "bg-info",
  open: "bg-success",
  bonn: "bg-gold",
};

/**
 * The open log — every seat sees every play.
 *
 * Built from this turn's stamped plays and the crisis's drift history, which is
 * exactly why Phase 1 kept resolved play rows rather than deleting them and
 * retained the last six drift rolls.
 */
export function FourPowerWire({ lines }: { lines: DossierWireLine[] }) {
  return (
    <section className="rounded-lg border border-gold/20 bg-background/60 px-5 py-4">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-gold/30 pb-2">
        <h2 className="font-mono text-body-xs font-bold tracking-wider text-gold">
          ▌FOUR-POWER WIRE · OPEN LOG
        </h2>
        <span className="flex items-center gap-1.5 font-mono text-body-xs font-semibold text-warning">
          <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-warning" />
          LIVE · EVERY SEAT SEES EVERY PLAY
        </span>
      </div>

      {lines.length === 0 ? (
        <p className="py-3 font-mono text-body-xs text-muted">
          Nothing on the wire yet. The first play of the turn appears here.
        </p>
      ) : (
        <ul>
          {lines.map((line, i) => (
            <li
              key={`${line.at}-${line.who}-${i}`}
              className="flex gap-2.5 border-b border-dashed border-gold/10 py-1.5 last:border-b-0"
            >
              <span className="w-10 shrink-0 font-mono text-body-xs text-muted">{line.at}</span>
              <span aria-hidden className={`w-0.5 shrink-0 rounded-sm ${BLOC_RULE[line.bloc]}`} />
              <p className="flex-1 font-mono text-body-xs leading-relaxed text-gold-muted">
                <span className={`font-semibold ${BLOC_TONE[line.bloc]}`}>{line.who}</span>{" "}
                {line.text}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

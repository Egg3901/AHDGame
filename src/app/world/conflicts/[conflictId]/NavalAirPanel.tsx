import type { NavalAirPanel as NavalAirPanelData } from "./conflictRecordView";

/**
 * The naval and air picture at a front.
 *
 * Four named figures, not one score. A commander losing a war needs to know WHICH of the
 * sky, the sea, the sorties, or the enemy's supply is the problem, because those have
 * different answers: contest the air, move the fleet, fly close air support, or strike
 * behind the line.
 *
 * Enemy strength appears only as a band. Force composition is fogged in this game by
 * design, and the air band is the one read the record gives.
 */
export function NavalAirPanel({ data }: { data: NavalAirPanelData }) {
  return (
    <section aria-labelledby="navair-heading" className="rounded border border-neutral-800 p-4">
      <h3 id="navair-heading" className="text-xs uppercase tracking-wide text-neutral-400">
        Air and sea
      </h3>

      <p className="mt-2 text-sm text-neutral-200">{data.airBand}</p>

      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <Figure label="Air superiority" value={`${Math.round(data.airSuperiority)}%`} />
        <Figure label="Sea control" value={`${Math.round(data.seaControl)}%`} />
        <Figure
          label="Close air support"
          value={data.casWeight > 0 ? `+${Math.round(data.casWeight)}` : "None flown"}
        />
        <Figure
          label="Enemy supply cut"
          value={data.interdiction > 0 ? `${Math.round(data.interdiction * 100)}%` : "None"}
        />
      </dl>

      {data.recentActions.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs uppercase tracking-wide text-neutral-500">Surface actions</h4>
          <ul className="mt-1 space-y-1 text-xs text-neutral-300">
            {data.recentActions.map((a) => (
              <li key={`${a.turn}-${a.regionName}`}>
                <span className="text-neutral-500 tabular-nums">T{a.turn}</span> {a.regionName}:{" "}
                {a.winner} held the water
                {a.sunk.length > 0 && (
                  <span className="text-red-400"> Lost: {a.sunk.join(", ")}.</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-3 text-xs text-neutral-400">
        {data.canLandMarines
          ? "You hold enough of the water to put marines ashore here."
          : "Not enough sea control to land marines here."}
      </p>
    </section>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-neutral-400">{label}</dt>
      <dd className="text-neutral-100 tabular-nums">{value}</dd>
    </div>
  );
}

"use client";

import { useState } from "react";

/** A problem with a formation that the commander can actually do something about. */
export interface FormationWarning {
  /** Short label shown against the formation. */
  text: string;
  severity: "bad" | "warn";
}

export interface CommandFormation {
  id: string;
  name: string;
  type: string;
  domain: "naval" | "air";
  station: string | null;
  stationName: string;
  mission: string | null;
  integrity: number;
  readiness: number;
  supply: number;
  /** True when the engine chose this posting, not the commander. */
  auto: boolean;
  warnings: FormationWarning[];
}

export interface MissionOption {
  key: string;
  label: string;
  desc: string;
}

/** The one-line answer to "how is my navy doing", shown before any of the detail. */
export interface ForceSummary {
  /** Regions where this country holds meaningful sea control, best first. */
  holding: { region: string; pct: number }[];
  /** Fronts this country is fighting on that are getting no close air support. */
  frontsWithoutAir: string[];
  /** Formations at or near the supply floor. */
  starving: number;
  atWar: boolean;
}

export interface StationOption {
  id: string;
  name: string;
  /** False for regions this formation cannot operate from, e.g. dry land for a fleet. */
  allowed: boolean;
}

/**
 * Naval and air command.
 *
 * Deliberately one screen for the whole force rather than a control buried in each war.
 * A fleet is not owned by a front: the decision a commander is actually making is where
 * to put a limited number of hulls and wings across every place that wants them, and that
 * decision is impossible to make while looking at one theatre at a time.
 *
 * Every posture shows what it does, in full, next to the choice. Naval and air missions
 * trade off in ways that are not guessable from their names: a carrier flying air patrol
 * is not blockading, and close air support flown into a contested sky loses the wing.
 */
export function NavairCommandClient({
  countryCode,
  positionId,
  formations,
  navalMissions,
  airMissions,
  stations,
  summary,
}: {
  countryCode: string;
  positionId: string;
  summary: ForceSummary;
  formations: CommandFormation[];
  navalMissions: MissionOption[];
  airMissions: MissionOption[];
  stations: StationOption[];
}) {
  const [rows, setRows] = useState(formations);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function send(id: string, patch: { mission?: string; station?: string }) {
    setBusy(id);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch(
        `/api/country/${countryCode}/executive/cabinet/${positionId}/navair/mission`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ unitId: id, ...patch }),
        }
      );
      const body = await res.json();
      if (!res.ok) {
        // Show the server's reason verbatim. It knows why, and paraphrasing it into
        // "something went wrong" is how a player ends up filing a ticket.
        setError(body?.error ?? "The order was refused.");
        return;
      }
      setRows((prev) =>
        prev.map((r) =>
          r.id === id
            ? { ...r, mission: patch.mission ?? r.mission, station: patch.station ?? r.station }
            : r
        )
      );
      setSaved(id);
    } catch {
      setError("Could not reach the ministry. The order was not sent.");
    } finally {
      setBusy(null);
    }
  }

  if (!rows.length) {
    return (
      <p className="text-sm text-neutral-400">
        This country has no naval or air formations to command.
      </p>
    );
  }

  const byStation = new Map<string, CommandFormation[]>();
  for (const r of rows) {
    const key = r.stationName;
    byStation.set(key, [...(byStation.get(key) ?? []), r]);
  }

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="rounded border border-red-800 bg-red-950/40 p-3 text-sm">
          {error}
        </p>
      )}

      {/* What this force is achieving, before any of the detail. A list of objects with
          dropdowns does not tell a commander what problem they are solving; this does. */}
      <section className="rounded border border-neutral-800 p-4">
        <h2 className="text-xs uppercase tracking-wide text-neutral-400">Where you stand</h2>
        <ul className="mt-2 space-y-1 text-sm text-neutral-200">
          <li>
            {summary.holding.length > 0 ? (
              <>
                You hold the water in{" "}
                {summary.holding.map((h) => `${h.region} (${Math.round(h.pct)}%)`).join(", ")}.
              </>
            ) : (
              <span className="text-amber-400">
                You do not control the sea anywhere. Fleets build control by sitting in water and
                holding an aggressive posture.
              </span>
            )}
          </li>

          {summary.atWar && summary.frontsWithoutAir.length > 0 && (
            <li className="text-amber-400">
              No close air support is reaching {summary.frontsWithoutAir.join(", ")}. Air wings in
              range set to Close Air Support add weight to the ground battle there.
            </li>
          )}

          {summary.starving > 0 && (
            <li className="text-red-400">
              {summary.starving} formation{summary.starving === 1 ? " is" : "s are"} out of supply.
              A fleet far from home in unfriendly waters cannot resupply, and an unsupplied
              formation fights at a fraction of its strength. Move them closer to home.
            </li>
          )}
        </ul>
      </section>

      <p className="text-sm text-neutral-400">
        Orders are standing: a formation keeps its posture until you change it. Changes take effect
        at the next turn. Anything marked <span className="text-neutral-300">Auto</span> was posted
        by the staff and will keep being repositioned until you give it an order.
      </p>

      {[...byStation.entries()].map(([stationName, group]) => (
        <section key={stationName}>
          <h2 className="text-xs uppercase tracking-wide text-neutral-400">{stationName}</h2>
          <ul className="mt-2 space-y-3">
            {group.map((f) => {
              const options = f.domain === "naval" ? navalMissions : airMissions;
              const current = options.find((o) => o.key === f.mission);
              return (
                <li key={f.id} className="rounded border border-neutral-800 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm text-neutral-100">{f.name}</span>
                    <span className="text-xs text-neutral-500">
                      {f.type}
                      {f.auto && (
                        <span className="ml-2 rounded border border-neutral-700 px-1 text-neutral-400">
                          Auto
                        </span>
                      )}
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-neutral-500 tabular-nums">
                    Condition {Math.round(f.integrity)}% · Readiness {Math.round(f.readiness)}% ·{" "}
                    <span className={f.supply <= 25 ? "text-red-400" : undefined}>
                      Supply {Math.round(f.supply)}%
                    </span>
                  </p>

                  {f.warnings.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {f.warnings.map((w) => (
                        <li
                          key={w.text}
                          className={w.severity === "bad" ? "text-red-400" : "text-amber-400"}
                        >
                          {w.text}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-3 flex flex-wrap gap-3">
                    <label className="text-xs text-neutral-400">
                      Orders
                      <select
                        className="ml-2 rounded border border-neutral-700 bg-neutral-900 p-1 text-neutral-100"
                        value={f.mission ?? ""}
                        disabled={busy === f.id}
                        onChange={(e) => send(f.id, { mission: e.target.value })}
                      >
                        {!f.mission && <option value="">No orders</option>}
                        {options.map((o) => (
                          <option key={o.key} value={o.key}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="text-xs text-neutral-400">
                      Station
                      <select
                        className="ml-2 rounded border border-neutral-700 bg-neutral-900 p-1 text-neutral-100"
                        value={f.station ?? ""}
                        disabled={busy === f.id}
                        onChange={(e) => send(f.id, { station: e.target.value })}
                      >
                        {stations.map((s) => (
                          <option
                            key={s.id}
                            value={s.id}
                            // A fleet cannot be ordered onto dry land. Disabling the option
                            // says so before the player tries, instead of after.
                            disabled={f.domain === "naval" && !s.allowed}
                          >
                            {s.name}
                            {f.domain === "naval" && !s.allowed ? " (no port)" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {current && <p className="mt-2 text-xs text-neutral-400">{current.desc}</p>}
                  {saved === f.id && (
                    <p className="mt-1 text-xs text-emerald-400">
                      Order sent. Effective next turn.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

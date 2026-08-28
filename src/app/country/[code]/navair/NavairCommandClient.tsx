"use client";

import { useState } from "react";

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
}

export interface MissionOption {
  key: string;
  label: string;
  desc: string;
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
}: {
  countryCode: string;
  positionId: string;
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

      <p className="text-sm text-neutral-400">
        Orders are standing: a formation keeps its posture until you change it. Changes take effect
        at the next turn.
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
                    <span className="text-xs text-neutral-500">{f.type}</span>
                  </div>

                  <p className="mt-1 text-xs text-neutral-500 tabular-nums">
                    Condition {Math.round(f.integrity)}% · Readiness {Math.round(f.readiness)}% ·
                    Supply {Math.round(f.supply)}%
                  </p>

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

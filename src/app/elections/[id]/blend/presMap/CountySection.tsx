"use client";

import { useEffect, useMemo, useState } from "react";
import { BLEND, FONT } from "@/components/blend/tokens";
import {
  buildCountyRows,
  defaultSortDir,
  sortCountyRows,
  type CountyApiResponse,
  type CountySortKey,
  type SortDir,
} from "./countyModel";
import { cachedCounties, countyKey, loadCounties } from "./countyStore";

type CountyLoad =
  { status: "loading" } | { status: "unavailable" } | { status: "ready"; data: CountyApiResponse };

const COLUMNS: { key: CountySortKey; label: string; align: "left" | "right" }[] = [
  { key: "name", label: "County", align: "left" },
  { key: "leader", label: "Leader", align: "left" },
  { key: "margin", label: "Margin", align: "right" },
  { key: "votes", label: "Votes", align: "right" },
];

export interface CountySectionProps {
  electionId: string;
  stateId: string;
  /** Changes when the race re-tallies, so a stale cached response is not reused. */
  turn: number | null;
  candidate: (id: string) => { name: string; color: string };
}

/**
 * County map and sortable table for one state. Geometry and results arrive
 * together from the subdivision-results route and are only requested once a
 * state is opened, never for the national map itself.
 */
export function CountySection({ electionId, stateId, turn, candidate }: CountySectionProps) {
  const cacheKey = countyKey(electionId, stateId, turn);
  /** Outcome of the last request, tagged with the key it answered. */
  const [settled, setSettled] = useState<{ key: string; load: CountyLoad } | null>(null);
  const [sort, setSort] = useState<{ key: CountySortKey; dir: SortDir }>({
    key: "votes",
    dir: "desc",
  });
  const [hovered, setHovered] = useState<string | null>(null);

  const cached = cachedCounties(cacheKey);
  const load: CountyLoad = cached
    ? { status: "ready", data: cached }
    : settled?.key === cacheKey
      ? settled.load
      : { status: "loading" };

  useEffect(() => {
    if (cachedCounties(cacheKey)) return;
    let live = true;
    loadCounties(electionId, stateId, turn).then((data) => {
      if (!live) return;
      setSettled({
        key: cacheKey,
        load: data ? { status: "ready", data } : { status: "unavailable" },
      });
    });
    return () => {
      live = false;
    };
  }, [cacheKey, electionId, stateId, turn]);

  const readyData = load.status === "ready" ? load.data : null;
  const rows = useMemo(
    () => (readyData ? buildCountyRows(readyData, candidate) : []),
    [readyData, candidate]
  );
  const sorted = useMemo(() => sortCountyRows(rows, sort.key, sort.dir), [rows, sort]);

  if (load.status === "loading") {
    return <Note>Loading county results...</Note>;
  }
  if (load.status === "unavailable") {
    return <Note>County results are not available for this state yet.</Note>;
  }

  return (
    <div>
      <svg
        viewBox={load.data.viewBox}
        role="img"
        aria-label={`County results map for ${stateId}`}
        style={{ display: "block", width: "100%", height: 190, background: BLEND.inset }}
        preserveAspectRatio="xMidYMid meet"
      >
        {rows.map((row) => (
          <path
            key={row.id}
            d={row.path}
            fill={row.fill}
            stroke={hovered === row.id ? BLEND.ink : BLEND.page}
            strokeWidth={hovered === row.id ? 1.6 : 0.5}
            vectorEffect="non-scaling-stroke"
            onPointerEnter={() => setHovered(row.id)}
            onPointerLeave={() => setHovered((h) => (h === row.id ? null : h))}
          >
            <title>{`${row.name}: ${row.winnerName || "no result"} +${row.margin.toFixed(1)}pp`}</title>
          </path>
        ))}
      </svg>

      <div
        style={{
          marginTop: 10,
          maxHeight: 232,
          overflowY: "auto",
          border: `1px solid ${BLEND.hairline}`,
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            tableLayout: "fixed",
            fontFamily: FONT.sans,
            fontSize: 12.5,
          }}
        >
          <colgroup>
            <col style={{ width: "27%" }} />
            <col style={{ width: "31%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "27%" }} />
          </colgroup>
          <thead>
            <tr>
              {COLUMNS.map((col) => {
                const active = sort.key === col.key;
                return (
                  <th
                    key={col.key}
                    aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                    style={{
                      position: "sticky",
                      top: 0,
                      background: BLEND.rail,
                      borderBottom: `1px solid ${BLEND.hairlineStrong}`,
                      padding: 0,
                      textAlign: col.align,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setSort((s) =>
                          s.key === col.key
                            ? { key: col.key, dir: s.dir === "asc" ? "desc" : "asc" }
                            : { key: col.key, dir: defaultSortDir(col.key) }
                        )
                      }
                      style={{
                        width: "100%",
                        padding: "6px 6px",
                        font: "inherit",
                        fontFamily: FONT.mono,
                        fontSize: 10,
                        letterSpacing: ".04em",
                        textTransform: "uppercase",
                        textAlign: col.align,
                        cursor: "pointer",
                        border: 0,
                        background: "transparent",
                        color: active ? BLEND.ink : BLEND.mutedDim,
                      }}
                    >
                      {col.label}
                      {active ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={row.id}
                onPointerEnter={() => setHovered(row.id)}
                onPointerLeave={() => setHovered((h) => (h === row.id ? null : h))}
                style={{
                  background: hovered === row.id ? BLEND.track : "transparent",
                  borderBottom: `1px solid ${BLEND.hairline}`,
                }}
              >
                <td style={{ padding: "5px 6px", color: BLEND.ink }}>{row.name}</td>
                <td style={{ padding: "5px 6px", color: BLEND.muted }}>
                  {row.winnerName ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <i
                        aria-hidden
                        style={{
                          width: 8,
                          height: 8,
                          background: row.winnerColor,
                          display: "block",
                        }}
                      />
                      {row.winnerName}
                    </span>
                  ) : (
                    "None"
                  )}
                </td>
                <td
                  style={{
                    padding: "5px 6px",
                    textAlign: "right",
                    fontFamily: FONT.mono,
                    fontSize: 11.5,
                    color: BLEND.ink,
                  }}
                >
                  {row.margin.toFixed(1)}
                </td>
                <td
                  style={{
                    padding: "5px 6px",
                    textAlign: "right",
                    fontFamily: FONT.mono,
                    fontSize: 11.5,
                    color: BLEND.muted,
                  }}
                >
                  {Math.round(row.votes).toLocaleString("en-US")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p
        style={{ margin: "6px 0 0", fontFamily: FONT.sans, fontSize: 11.5, color: BLEND.mutedDim }}
      >
        County figures are the state projection spread by local lean. Margin is in points.
      </p>
    </div>
  );
}

function Note({ children }: { children: string }) {
  return (
    <p style={{ margin: 0, fontFamily: FONT.sans, fontSize: 13, color: BLEND.mutedDim }}>
      {children}
    </p>
  );
}

"use client";

import Link from "next/link";
import { FONT } from "@/components/blend/tokens";
import { electionRegionUrl } from "@/lib/urls";
import { FOG_FILL } from "./StateShapes";
import { stateFigure, type PresMapModel } from "./presMapModel";

/**
 * Every state as an equal square, in the same fills the map uses. The map's
 * alternative on the stage: small states are as easy to read as large ones.
 * Each square opens that state's race page.
 */
export function StateSquares({
  model,
  electionId,
  countryId,
  columns = 11,
}: {
  model: PresMapModel;
  electionId: string;
  countryId: string;
  columns?: number;
}) {
  const states = Object.values(model.states).sort((a, b) => a.id.localeCompare(b.id));
  if (states.length === 0) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 4 }}>
      {states.map((s) => {
        const figure = stateFigure(s);
        const title = s.caption
          ? `${s.name}: ${s.caption}`
          : `${s.name}: ${s.leaderName} +${s.margin.toFixed(1)}pp`;
        return (
          <Link
            key={s.id}
            href={electionRegionUrl(electionId, countryId, s.id)}
            title={title}
            aria-label={title}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              aspectRatio: "1",
              color: s.ink,
              background: s.fill || FOG_FILL,
              textDecoration: "none",
            }}
          >
            <span style={{ fontFamily: FONT.mono, fontSize: 12, fontWeight: 700 }}>{s.id}</span>
            {figure ? (
              <span style={{ fontFamily: FONT.mono, fontSize: 10.5, opacity: 0.8 }}>{figure}</span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}

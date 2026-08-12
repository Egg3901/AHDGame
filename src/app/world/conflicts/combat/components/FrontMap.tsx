"use client";

import { useMemo } from "react";
import { RegionalGeoMap, type RegionCell } from "@/components/maps/RegionalGeoMap";
import { useRegionGeometry } from "@/lib/maps/useRegionGeometry";
import { useStaticHostGeometry } from "@/lib/maps/proxyHostGeometry";
import { orderFeatures, occupiedCodes } from "@/lib/maps/frontGeometry";
import { anchorOf } from "@/lib/maps/countryAnchors";
import { MIL_COLOR, MIL_FONT } from "../../military/theme";
import type { ConflictView } from "../useCombatState";

const mono = MIL_FONT.mono;

/** Colour a side reads as on the front map — side A blue, side B red. */
const SIDE_COLOR = { A: MIL_COLOR.blue, B: MIL_COLOR.red } as const;

/**
 * SVG box per host, COPIED from the country map's `countryMapConfigs` so the front
 * is framed exactly as that country's own map is. Only countries with a real
 * config appear here — the rest take RegionalGeoMap's portrait default, which is
 * what UK/DE/JP/BR use there too.
 *
 * A wide host with no config yet (e.g. RU) will letterbox in the portrait default.
 * The fix is to add its box HERE when that country gains a map config — not to
 * invent dimensions, which is how this table first went wrong.
 */
const MAP_BOX: Record<string, { width: number; height: number }> = {
  CN: { width: 480, height: 340 },
  NG: { width: 480, height: 340 },
  US: { width: 800, height: 600 },
};
const DEFAULT_BOX = { width: 280, height: 400 };

/**
 * The territorial state of one conflict: a two-tone meter of who holds how much of
 * the host country, and the host's own regions shaded along the axis of advance.
 *
 * Geometry comes from the SHARED map stack — `useRegionGeometry` loads and merges
 * the manifest shards (cached per URL), `RegionalGeoMap` projects and draws them —
 * exactly as every other country map in the app does. The only bespoke part is
 * deciding WHICH regions the advance has taken, which is what `frontGeometry` does.
 *
 * The war's persisted state is a single number (ConflictDoc.control); the shading is
 * DERIVED from it here, so no per-region occupation is stored anywhere. A host with
 * no manifest geometry degrades to the meter alone.
 */
export function FrontMap({ conflict }: { conflict: ConflictView }) {
  const { hostRegionCodes } = conflict;
  const regionGeometry = useRegionGeometry(hostRegionCodes);
  // A proxy war's host is not a full country, so it has no region codes and the
  // shard machinery finds nothing for it. Its static feature is merged in here —
  // and its code into the ROSTER below, without which RegionalGeoMap filters the
  // feature straight back out and draws an empty box.
  const staticHost = useStaticHostGeometry(conflict.hostCountry);
  // Null means LOADING, as it does in `useRegionGeometry` — so both sources have to
  // have resolved before this is an answer. Collapsing an unresolved source to []
  // would report "no geometry" while a shard was still in flight, and the map would
  // settle on the meter before its own features arrived.
  const features = useMemo(() => {
    if (regionGeometry.features == null || staticHost.features == null) return null;
    return [...regionGeometry.features, ...staticHost.features];
  }, [regionGeometry.features, staticHost.features]);
  const rosterCodes = useMemo(
    () => [...hostRegionCodes, ...staticHost.codes],
    [hostRegionCodes, staticHost.codes]
  );

  const pctB = Math.round(conflict.control);
  const pctA = 100 - pctB;
  const occupiedPct = conflict.occupier === "A" ? pctA : conflict.occupier === "B" ? pctB : null;
  const occupierLabel =
    conflict.occupier === "A"
      ? conflict.sideALabel
      : conflict.occupier === "B"
        ? conflict.sideBLabel
        : null;

  // With no occupier the host belongs to neither side; the split is still drawn,
  // oriented by side A so the picture is stable.
  const advancingSide: "A" | "B" = conflict.occupier === "B" ? "B" : "A";
  const holdingSide: "A" | "B" = advancingSide === "A" ? "B" : "A";
  const takenPct = advancingSide === "B" ? pctB : pctA;

  const { advLabel, holdLabel } = {
    advLabel: advancingSide === "A" ? conflict.sideALabel : conflict.sideBLabel,
    holdLabel: holdingSide === "A" ? conflict.sideALabel : conflict.sideBLabel,
  };

  // regionCode → who holds it. RegionalGeoMap colours from this.
  const regionData = useMemo<Record<string, RegionCell>>(() => {
    if (!features || features.length === 0) return {};
    const ordered = orderFeatures(features, anchorOf(conflict.occupierCountry ?? ""));
    const taken = occupiedCodes(ordered, takenPct);
    const out: Record<string, RegionCell> = {};
    for (const f of ordered) {
      const code = f.properties?.regionCode;
      if (!code) continue;
      const held = taken.has(code);
      out[code] = {
        color: held ? SIDE_COLOR[advancingSide] : SIDE_COLOR[holdingSide],
        tooltip: [held ? `Held by ${advLabel}` : `Held by ${holdLabel}`],
      };
    }
    return out;
  }, [
    features,
    conflict.occupierCountry,
    takenPct,
    advancingSide,
    holdingSide,
    advLabel,
    holdLabel,
  ]);

  const box = MAP_BOX[conflict.hostCountry] ?? DEFAULT_BOX;
  const hasGeometry = features != null && features.length > 0;

  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          font: `600 9px ${mono}`,
          letterSpacing: ".14em",
          color: MIL_COLOR.textFaint,
          marginBottom: 6,
        }}
      >
        TERRITORY · {conflict.hostCountry}
      </div>

      <div style={{ font: `500 11px ${mono}`, color: MIL_COLOR.text, marginBottom: 6 }}>
        {occupiedPct !== null && occupierLabel
          ? `${occupierLabel} occupies ${occupiedPct}% of ${conflict.hostCountry}`
          : `Contested — ${conflict.sideALabel} ${pctA}% / ${conflict.sideBLabel} ${pctB}%`}
      </div>

      <div
        style={{
          display: "flex",
          height: 8,
          borderRadius: 4,
          overflow: "hidden",
          border: `1px solid ${MIL_COLOR.border}`,
        }}
      >
        <div style={{ width: `${pctA}%`, background: SIDE_COLOR.A }} />
        <div style={{ width: `${pctB}%`, background: SIDE_COLOR.B }} />
      </div>

      {hasGeometry ? (
        <div
          data-front-map
          style={{
            marginTop: 10,
            borderRadius: 8,
            border: `1px solid ${MIL_COLOR.borderSoft}`,
            background: MIL_COLOR.bg,
            padding: 6,
            aspectRatio: `${box.width}/${box.height}`,
          }}
        >
          <RegionalGeoMap
            features={features}
            regionCodes={rosterCodes}
            regionData={regionData}
            width={box.width}
            height={box.height}
          />
        </div>
      ) : (
        <div style={{ font: `500 10px ${mono}`, color: MIL_COLOR.textFaint, marginTop: 8 }}>
          {features == null
            ? "Plotting the front…"
            : "No mapped territory for this host — front line shown as a meter only."}
        </div>
      )}
    </div>
  );
}

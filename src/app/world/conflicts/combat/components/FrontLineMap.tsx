"use client";

import { useId, useMemo } from "react";
import { useRegionGeometry } from "@/lib/maps/useRegionGeometry";
import { useStaticHostGeometry } from "@/lib/maps/proxyHostGeometry";
import { projectRegions, type ProjectedRegion } from "@/lib/maps/projectRegions";
import {
  axisWords,
  fallbackAdvanceAnchor,
  frontLine,
  sampleLand,
  type FrontBox,
  type PxPoint,
} from "@/lib/maps/frontLine";
import { anchorOf } from "@/lib/maps/countryAnchors";
import { MIL_COLOR, MIL_FONT } from "../../military/theme";

const mono = MIL_FONT.mono;
const A_COLOR = MIL_COLOR.blue;
const B_COLOR = MIL_COLOR.red;

/** How near the line a region's centre must be to count as contested, in px. */
export const CONTESTED_PX = 17;

/**
 * The px box a host is projected into.
 *
 * The DIMENSIONS matter, not just the ratio: the line's jitter is tuned in px
 * (±17px around its nominal position), so a box half this size would double the
 * apparent roughness of the terrain. Aspect ratios mirror `FrontMap`'s `MAP_BOX`
 * so a front frames its host the way that country's own map does.
 */
const FRONT_BOX: Record<string, FrontBox> = {
  CN: { w: 900, h: 638 },
  NG: { w: 900, h: 638 },
  US: { w: 1000, h: 750 },
  // No entry for a proxy-war host: none of them is a playable country, so none has
  // a map config to copy a box FROM, and inventing dimensions is how this table
  // went wrong before. The portrait default suits them — Vietnam is tall and
  // narrow, which is exactly the shape that default was chosen for.
};
const DEFAULT_FRONT_BOX: FrontBox = { w: 620, h: 837 };

export interface FrontLineMapProps {
  hostCountry: string;
  hostRegionCodes: string[];
  /** Side B's share of the host, 0–100 (`ConflictDoc.control`). */
  control: number;
  /** Side A's belligerents, nearest-anchored first — orients the axis of advance. */
  sideACountries: string[];
  /** Side B's belligerents, the fallback orientation when side A has no anchor. */
  sideBCountries: string[];
  /**
   * Faction entity ids (SVN / NVN on a proxy war). Belligerent rosters stay
   * empty on purpose; these still place the axis of advance.
   */
  sideAFaction?: string;
  sideBFaction?: string;
  sideALabel: string;
  sideBLabel: string;
}

/** The first of these countries with a map anchor, or null. */
function firstAnchor(countries: string[]): [number, number] | null {
  for (const c of countries) {
    const a = anchorOf(c);
    if (a) return a;
  }
  return null;
}

interface FrontGeometry {
  box: FrontBox;
  regions: ProjectedRegion[];
  silhouette: string[];
  line: string;
  taken: string;
  contested: ProjectedRegion[];
  /** Words for the ADVANCING side's push — the side holding more than half. */
  axis: string;
  advancing: "A" | "B";
}

/**
 * The front line across a host country: two-tone ground clipped to the host's
 * silhouette, the Länder borders on top, and the line itself.
 *
 * The whole picture is derived from ONE persisted number (`ConflictDoc.control`)
 * plus an axis of advance running from the advancing side's own anchor into the
 * host. Nothing per-region is stored, and nothing here fetches ownership — only
 * geometry, through the same shard loader every other country map uses.
 *
 * This replaces `FrontMap`'s per-region colour swap on the conflict record.
 * That approach painted whole Länder in the order `orderFeatures` walked them,
 * and with no occupier (the host fights on neither side, which is the normal case
 * for a proxy war) it walked periphery-inward — so a Warsaw Pact holding 80% of
 * Germany still showed Berlin, Saxony and Mecklenburg on NATO's side of a war it
 * was plainly winning. A line cannot do that: it has an orientation.
 */
export function FrontLineMap({
  hostCountry,
  hostRegionCodes,
  control,
  sideACountries,
  sideBCountries,
  sideAFaction,
  sideBFaction,
  sideALabel,
  sideBLabel,
}: FrontLineMapProps) {
  const uid = useId().replace(/:/g, "");
  const regionGeometry = useRegionGeometry(hostRegionCodes);
  // A proxy war's host has no region codes at all, so the shard machinery returns
  // nothing for it. Its static feature AND its roster code are merged in — the
  // filter below drops any feature whose code is not in `codeKey`, so supplying
  // one without the other renders an empty box.
  const staticHost = useStaticHostGeometry(hostCountry);
  const features = useMemo(
    () => [...(regionGeometry.features ?? []), ...(staticHost.features ?? [])],
    [regionGeometry.features, staticHost.features]
  );

  const pctB = Math.round(control);
  const pctA = 100 - pctB;

  // Keyed on the sorted roster + control so the projection and the (comparatively
  // expensive) land sample are recomputed only when the war actually moves.
  const codeKey = [...hostRegionCodes, ...staticHost.codes].sort().join(",");
  const aKey = [...sideACountries, ...(sideAFaction ? [sideAFaction] : [])].join(",");
  const bKey = [...sideBCountries, ...(sideBFaction ? [sideBFaction] : [])].join(",");

  const geo = useMemo<FrontGeometry | null>(() => {
    if (!features || features.length === 0) return null;
    const codes = new Set(codeKey ? codeKey.split(",") : []);
    const own = features.filter((f) => {
      const c = f.properties?.regionCode;
      return c != null && codes.has(c);
    });
    const box = FRONT_BOX[hostCountry] ?? DEFAULT_FRONT_BOX;
    const projected = projectRegions(own, box);
    if (!projected) return null;

    const land = sampleLand(projected.rings, box);

    // The axis runs from side A's anchor toward the host, and `pctA` of the
    // ground nearest that anchor is side A's. Side B's anchor reversed is the
    // fallback, for a war whose side A is the host itself (its anchor sits on the
    // host's own centre, which is no direction at all).
    const aAnchor = firstAnchor(aKey ? aKey.split(",") : []);
    const bAnchor = firstAnchor(bKey ? bKey.split(",") : []);
    const centre: PxPoint = [box.w / 2, box.h / 2];
    const usable = (ll: [number, number] | null): PxPoint | null => {
      if (!ll) return null;
      const p = projected.project(ll);
      return Math.hypot(p[0] - centre[0], p[1] - centre[1]) > box.w * 0.35 ? p : null;
    };

    let anchor = usable(aAnchor);
    if (!anchor) {
      // Mirror B's anchor about the host's centre: an advance FROM the east is an
      // advance TOWARD the west, and side A's share still positions the line.
      const b = usable(bAnchor);
      if (b) anchor = [2 * centre[0] - b[0], 2 * centre[1] - b[1]];
    }
    if (!anchor) {
      // Neither side is placed on the world. Follow the host's long side so a
      // tall country (Vietnam) reads north-south and a wide one stays west-east.
      anchor = fallbackAdvanceAnchor(box);
    }

    const front = frontLine(box, land, anchor, pctA);
    if (!front) return null;

    const contested = projected.regions
      .filter((r) => Math.abs(front.gap([r.cx, r.cy])) < CONTESTED_PX)
      .sort((a, b) => b.area - a.area);

    // Name the push of whichever side is actually ahead — that is the movement a
    // reader is looking for. Side A advances along `u`; side B advances against it.
    const advancingIsA = pctA >= pctB;
    const axis = axisWords(advancingIsA ? front.u : ([-front.u[0], -front.u[1]] as PxPoint));

    return {
      box,
      regions: projected.regions,
      silhouette: projected.regions.map((r) => r.d),
      line: front.line,
      taken: front.taken,
      contested,
      axis,
      advancing: advancingIsA ? "A" : "B",
    };
  }, [features, codeKey, hostCountry, aKey, bKey, pctA, pctB]);

  const legend = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 14,
        marginTop: 12,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <LegendKey color={A_COLOR} label={`${sideALabel} ground`} />
        <LegendKey color={B_COLOR} label={`${sideBLabel} ground`} />
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            font: `500 10px ${mono}`,
            color: MIL_COLOR.textMuted,
          }}
        >
          <span style={{ width: 18, height: 2, background: MIL_COLOR.textStrong }} />
          front line
        </span>
      </div>
      <div style={{ font: `500 10px ${mono}`, color: MIL_COLOR.textFaint }}>
        Contested sectors:{" "}
        <span style={{ color: MIL_COLOR.amber }}>
          {geo == null
            ? "…"
            : geo.contested.length > 0
              ? geo.contested
                  .slice(0, 5)
                  .map((r) => r.name)
                  .join(" · ")
              : "none — the line runs clear"}
        </span>
      </div>
    </div>
  );

  return (
    <div
      style={{
        border: `1px solid ${MIL_COLOR.border}`,
        borderRadius: 14,
        background: MIL_COLOR.panel,
        padding: "16px 18px 14px",
        // A flex column so the canvas between the header and the legend can take
        // the slack, letting the panel match the rail beside it.
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{ font: `600 9px ${mono}`, letterSpacing: ".14em", color: MIL_COLOR.textFaint }}
        >
          THE FRONT LINE · {hostCountry}
        </div>
        {geo && (
          <div style={{ font: `500 10px ${mono}`, color: MIL_COLOR.textMuted }}>
            Axis of advance{" "}
            <span style={{ color: geo.advancing === "A" ? A_COLOR : B_COLOR }}>{geo.axis}</span> ·
            the line pulses live
          </div>
        )}
      </div>

      <div
        className="cw-front-canvas"
        data-front-map
        style={
          {
            borderRadius: 10,
            border: `1px solid ${MIL_COLOR.borderSoft}`,
            background: MIL_COLOR.bg,
            padding: 8,
            position: "relative",
            // The host's own proportions, for the stacked breakpoint to size the
            // box by. Portrait Germany and landscape China cannot share a number.
            "--cw-front-aspect": geo ? `${geo.box.w} / ${geo.box.h}` : undefined,
          } as React.CSSProperties
        }
      >
        {geo ? (
          <svg
            viewBox={`0 0 ${geo.box.w} ${geo.box.h}`}
            width="100%"
            height="100%"
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label={`Front line across ${hostCountry}: ${sideALabel} holds ${pctA}%, ${sideBLabel} holds ${pctB}%`}
            // `hidden`, not the design's `visible`. The advancing side's fill is a
            // path deliberately extended 4000 units behind the line, so it is ~1800
            // CSS px wider than the frame. The silhouette clipPath contains it today
            // — but with overflow visible, a clipPath that failed to resolve (a
            // duplicate id, an engine that mishandles it) would paint that fill
            // straight across the page instead of degrading to a plain map.
            style={{ display: "block", overflow: "hidden" }}
          >
            <defs>
              <clipPath id={`cw-sil-${uid}`}>
                {geo.silhouette.map((d, i) => (
                  <path key={i} d={d} />
                ))}
              </clipPath>
            </defs>

            {/* Side B fills the whole host; side A's ground is painted back over
                it. Both are clipped to the silhouette, so the sea stays empty. */}
            <g clipPath={`url(#cw-sil-${uid})`}>
              <rect
                x={0}
                y={0}
                width={geo.box.w}
                height={geo.box.h}
                fill={B_COLOR}
                fillOpacity={0.8}
              />
              <path d={geo.taken} fill={A_COLOR} fillOpacity={0.8} />
            </g>

            <g fill="none" stroke="rgba(255,255,255,.16)" strokeWidth={0.7}>
              {geo.regions.map((r) => (
                <path key={r.id} d={r.d} />
              ))}
            </g>

            <g clipPath={`url(#cw-sil-${uid})`} fill="none" strokeLinecap="round">
              <path className="cw-fl-glow" d={geo.line} strokeWidth={17} />
              <path
                className="cw-fl-core"
                d={geo.line}
                stroke={MIL_COLOR.textStrong}
                strokeWidth={2.1}
              />
              <path
                className="cw-fl-scan"
                d={geo.line}
                stroke="#fff"
                strokeWidth={4}
                strokeOpacity={0.55}
                strokeDasharray="26 210"
              />
              <path
                className="cw-fl-scan-back"
                d={geo.line}
                stroke={B_COLOR}
                strokeWidth={6}
                strokeOpacity={0.5}
                strokeDasharray="12 300"
              />
            </g>

            <g>
              {geo.regions.map((r) => (
                <text
                  key={r.id}
                  x={r.cx}
                  y={r.cy}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={13}
                  fontWeight={700}
                  fill="rgba(255,255,255,.92)"
                  stroke="rgba(0,0,0,.35)"
                  strokeWidth={13 * 0.22}
                  style={{ pointerEvents: "none", userSelect: "none", paintOrder: "stroke" }}
                >
                  {r.id}
                </text>
              ))}
            </g>
          </svg>
        ) : (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              font: `500 11px ${mono}`,
              color: MIL_COLOR.textFaint,
              padding: 20,
            }}
          >
            {features == null
              ? "Plotting the front…"
              : `No mapped territory for ${hostCountry} — the split above is the whole picture.`}
          </div>
        )}
      </div>

      {legend}
    </div>
  );
}

function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        font: `500 10px ${mono}`,
        color: MIL_COLOR.textMuted,
      }}
    >
      <span style={{ width: 11, height: 11, borderRadius: 3, background: color }} />
      {label}
    </span>
  );
}

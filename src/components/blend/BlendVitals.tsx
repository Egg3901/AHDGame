"use client";

import { BLEND, FONT } from "./tokens";

export interface BlendVitalCell {
  label: string;
  value: string;
  /** Optional second line under the value. */
  sub?: string;
  /** Value ink. Defaults to the Blend primary ink. */
  color?: string;
}

export interface BlendVitalsProps {
  cells: BlendVitalCell[];
  /**
   * Mobile renders the same cells in a 2-up grid at smaller type. Desktop is
   * a single row of equal columns.
   */
  variant?: "desktop" | "mobile";
}

/**
 * The Blend vitals strip: the headline numbers for the screen, in a hairline
 * grid directly under the ticker.
 */
export function BlendVitals({ cells, variant = "desktop" }: BlendVitalsProps) {
  const mobile = variant === "mobile";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: mobile ? "1fr 1fr" : `repeat(${cells.length}, 1fr)`,
        borderBottom: `1px solid ${mobile ? BLEND.hairline : BLEND.hairlineStrong}`,
      }}
    >
      {cells.map((c, i) => (
        <div
          key={c.label}
          data-blend-vital=""
          style={{
            padding: mobile ? "13px 16px" : "16px 20px",
            // Desktop rules every cell but the last; mobile rules every cell,
            // because the 2-up grid wraps.
            ...(mobile
              ? {
                  borderRight: `1px solid ${BLEND.hairline}`,
                  borderBottom: `1px solid ${BLEND.hairline}`,
                }
              : i < cells.length - 1
                ? { borderRight: `1px solid ${BLEND.hairline}` }
                : {}),
          }}
        >
          <div
            style={{
              fontFamily: FONT.mono,
              fontSize: mobile ? 9 : 9.5,
              letterSpacing: ".14em",
              textTransform: "uppercase",
              color: BLEND.mutedDimmer,
            }}
          >
            {c.label}
          </div>
          <div
            style={{
              marginTop: mobile ? 5 : 7,
              fontFamily: FONT.mono,
              fontSize: mobile ? 19 : 23,
              fontWeight: 500,
              letterSpacing: "-0.02em",
              color: c.color ?? BLEND.ink,
            }}
          >
            {c.value}
          </div>
          {c.sub ? (
            <div
              style={{
                marginTop: mobile ? 2 : 3,
                fontFamily: FONT.serif,
                fontSize: mobile ? 12 : 12.5,
                color: BLEND.mutedDim,
              }}
            >
              {c.sub}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

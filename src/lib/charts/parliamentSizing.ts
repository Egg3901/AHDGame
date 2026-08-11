/**
 * Shared geometry helpers for hemicycle parliament charts.
 *
 * Used by both the client `<ParliamentChart>` and the server-side
 * `generateParliamentChartSVG` so both renderings stay consistent for
 * chambers of any size (US Senate 100 → CN NPC 2980).
 *
 * All values are in the base 400-unit viewBox coordinate system used by
 * `<ParliamentChart>`. The server-side generator scales them.
 */

export interface ParliamentSizing {
  dotR: number;
  rowGap: number;
  innerR: number;
  isSenate: boolean;
}

/**
 * Tier sizing tuned so that the outer arc radius stays within ~195 units
 * (half of the default 400-unit viewBox width). Above this radius the
 * dynamic viewBox in the renderer expands as a safety net.
 *
 * Breakpoints chosen so existing chambers keep their current visual:
 *  - US Senate (100)           → senate tier
 *  - UK Commons (650), DE (736) → large tier (unchanged)
 *  - >750: progressively smaller dots
 *  - >1500: tuned to fit CN NPC (2980) without clipping
 */
export function getParliamentSizing(total: number): ParliamentSizing {
  if (total <= 110) return { dotR: 7, rowGap: 20, innerR: 55, isSenate: true };
  if (total <= 200) return { dotR: 5, rowGap: 14, innerR: 50, isSenate: false };
  if (total <= 750) return { dotR: 3.4, rowGap: 10, innerR: 45, isSenate: false };
  if (total <= 1500) return { dotR: 2.2, rowGap: 6.5, innerR: 38, isSenate: false };
  return { dotR: 1.6, rowGap: 4.5, innerR: 33, isSenate: false };
}

/**
 * Run the row-packing loop used by both renderers and report what comes out:
 * the list of row radii and the resulting outer radius. Lets tests assert
 * that each tier keeps `outerR` within the dynamic viewBox budget, and lets
 * the renderers reuse one code path.
 */
export function computeRowRadii(
  sizing: ParliamentSizing,
  total: number
): { rowRadii: number[]; outerR: number } {
  const minGap = sizing.dotR * 2.4;
  const rowRadii: number[] = [];
  let totalCap = 0;
  for (let row = 0; totalCap < total; row++) {
    const r = sizing.innerR + row * sizing.rowGap;
    const cap = Math.max(1, Math.floor((Math.PI * r) / minGap));
    rowRadii.push(r);
    totalCap += cap;
  }
  const outerR = rowRadii.length === 0 ? sizing.innerR : rowRadii[rowRadii.length - 1];
  return { rowRadii, outerR };
}

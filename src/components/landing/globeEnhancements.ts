// src/components/landing/globeEnhancements.ts
/** Pure data helpers for the enhanced landing globe. Deterministic (no
 *  Math.random/Date.now at module load) so SSR === CSR. Colors are CSS-var tokens. */

export type ArcSpec = { id: string; from: [number, number]; to: [number, number]; color: string };
export type HotspotSpec = { id: string; lonLat: [number, number]; label: string };
export type StarSpec = {
  id: string;
  cx: number;
  cy: number;
  r: number;
  opacity: number;
  /** Seconds to offset the shared twinkle animation, so stars shimmer out of phase. */
  twinkleDelay: number;
};

export function buildArcs(): ArcSpec[] {
  const US: [number, number] = [-77.0, 38.9];
  const UK: [number, number] = [-0.1, 51.5];
  const RU: [number, number] = [37.6, 55.75];
  const CN: [number, number] = [116.4, 39.9];
  const JP: [number, number] = [139.7, 35.7];
  const DD: [number, number] = [13.4, 52.5];
  return [
    { id: "US-RU", from: US, to: RU, color: "var(--warning)" },
    { id: "US-UK", from: US, to: UK, color: "var(--success)" },
    { id: "RU-CN", from: RU, to: CN, color: "var(--danger)" },
    { id: "US-JP", from: US, to: JP, color: "var(--info)" },
    { id: "RU-DD", from: RU, to: DD, color: "var(--primary)" },
  ];
}

export function buildHotspots(): HotspotSpec[] {
  return [
    { id: "berlin", lonLat: [13.4, 52.5], label: "Berlin" },
    { id: "kabul", lonLat: [69.1, 34.5], label: "Kabul" },
    { id: "tehran", lonLat: [51.4, 35.7], label: "Tehran" },
  ];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildStarfield(opts?: {
  count?: number;
  seed?: number;
  width?: number;
  height?: number;
}): StarSpec[] {
  // The hero embed crops this canvas down to a small sliver around the globe
  // (oversized background container, off-center), so only a fraction of these
  // ever end up on-screen — count high so that fraction still reads as a field.
  const count = opts?.count ?? 260;
  const seed = opts?.seed ?? 1337;
  const width = opts?.width ?? 640;
  const height = opts?.height ?? 368;
  const rand = mulberry32(seed);
  const stars: StarSpec[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      id: `star-${i}`,
      cx: Math.round(rand() * width * 100) / 100,
      cy: Math.round(rand() * height * 100) / 100,
      r: Math.round((0.3 + rand() * 0.4) * 100) / 100,
      opacity: Math.round((0.45 + rand() * 0.45) * 100) / 100,
      twinkleDelay: Math.round(rand() * 4.5 * 100) / 100,
    });
  }
  return stars;
}

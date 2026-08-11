import type { ReactNode } from "react";
import type { CountryId } from "@/lib/constants/countries";
import { getNationalIdentity, type SealMotif } from "@/lib/constants/nationalIdentity";
import { hexToRgba, lightenHex } from "./identityColor";

interface NationalSealProps {
  country: CountryId;
  /** Square edge length in px. */
  size?: number;
  /**
   * Override the stamp glyph (defaults to the national identity's). Lets the
   * Treasury surface render its finance-ministry chop (e.g. 财) over the same
   * per-country emblem.
   */
  glyph?: string;
  /** Override the glyph serif style; defaults to the national identity's. */
  serif?: "cjk" | "mono";
  /** Override the ring motif; defaults to the national identity's. */
  motif?: SealMotif;
  className?: string;
}

const SERIF_CJK = "'Noto Serif SC', 'Noto Serif JP', 'Songti SC', serif";
const SERIF_MONO = "'Playfair Display', Georgia, 'Times New Roman', serif";

// ── geometry (120×120 viewBox, centered at C) ──────────────────────────────
const C = 60;
function P(r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
}
const f = (n: number) => Number(n.toFixed(2));
function starPath(
  cx: number,
  cy: number,
  ro: number,
  ri: number,
  pts: number,
  rot: number
): string {
  let d = "";
  for (let i = 0; i < pts * 2; i++) {
    const r = i % 2 === 0 ? ro : ri;
    const a = ((rot + (i * 180) / pts - 90) * Math.PI) / 180;
    d += (i === 0 ? "M" : "L") + f(cx + r * Math.cos(a)) + " " + f(cy + r * Math.sin(a));
  }
  return d + "Z";
}

// ── motif builders (return SVG primitives) ─────────────────────────────────
// `a` = accent (primary line), `s` = accentSoft (hairline). Each is an original
// geometric mark — no official coat of arms.
function gearStar(a: string, s: string): ReactNode {
  const teeth = Array.from({ length: 24 }, (_, i) => (
    <rect
      key={`t${i}`}
      x={f(C - 1.7)}
      y={f(C - 54)}
      width={3.4}
      height={6.5}
      rx={1}
      fill={a}
      transform={`rotate(${(i * 360) / 24} ${C} ${C})`}
    />
  ));
  const [lx, ly] = P(42, -34);
  const [rx, ry] = P(42, 34);
  return (
    <>
      {teeth}
      <circle cx={C} cy={C} r={49.5} fill="none" stroke={a} strokeWidth={2.4} />
      <circle cx={C} cy={C} r={45} fill="none" stroke={s} strokeWidth={1} opacity={0.5} />
      <path d={starPath(C, 13.5, 6.2, 2.7, 5, 0)} fill={a} />
      <path d={starPath(lx, ly, 3.4, 1.5, 5, 0)} fill={a} opacity={0.9} />
      <path d={starPath(rx, ry, 3.4, 1.5, 5, 0)} fill={a} opacity={0.9} />
    </>
  );
}
function starRing(a: string, s: string): ReactNode {
  const stars = Array.from({ length: 13 }, (_, i) => {
    const [x, y] = P(45.5, (i * 360) / 13);
    return <path key={`s${i}`} d={starPath(x, y, 3.4, 1.5, 5, 0)} fill={a} />;
  });
  return (
    <>
      <circle cx={C} cy={C} r={51} fill="none" stroke={a} strokeWidth={2.4} />
      <circle cx={C} cy={C} r={40} fill="none" stroke={s} strokeWidth={1} opacity={0.5} />
      {stars}
    </>
  );
}
function laurel(a: string, s: string): ReactNode {
  const leaves: ReactNode[] = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const ang = side * (110 + i * 11);
      const [x, y] = P(48.5, ang);
      leaves.push(
        <ellipse
          key={`l${side}-${i}`}
          cx={f(x)}
          cy={f(y)}
          rx={2.1}
          ry={4.2}
          fill={a}
          opacity={0.92}
          transform={`rotate(${ang + (side > 0 ? 28 : -28)} ${f(x)} ${f(y)})`}
        />
      );
    }
  }
  return (
    <>
      <circle cx={C} cy={C} r={51} fill="none" stroke={a} strokeWidth={1.6} />
      <circle cx={C} cy={C} r={46.5} fill="none" stroke={a} strokeWidth={3} />
      <circle cx={C} cy={C} r={42} fill="none" stroke={s} strokeWidth={1} opacity={0.5} />
      {leaves}
      <circle cx={C} cy={9.5} r={3.1} fill={a} />
      <circle cx={C} cy={9.5} r={1.3} fill={s} />
    </>
  );
}
function gear(a: string, s: string): ReactNode {
  const teeth = Array.from({ length: 16 }, (_, i) => (
    <rect
      key={`g${i}`}
      x={f(C - 3.1)}
      y={f(C - 56)}
      width={6.2}
      height={10}
      rx={1.4}
      fill={a}
      transform={`rotate(${(i * 360) / 16} ${C} ${C})`}
    />
  ));
  return (
    <>
      {teeth}
      <circle cx={C} cy={C} r={48} fill="none" stroke={a} strokeWidth={3.4} />
      <circle cx={C} cy={C} r={43} fill="none" stroke={s} strokeWidth={1} opacity={0.45} />
    </>
  );
}
function rays(a: string, s: string): ReactNode {
  const n = 16;
  const w = (360 / n) * 0.4;
  const beams = Array.from({ length: n }, (_, i) => {
    const ang = (i * 360) / n;
    const [x1, y1] = P(40, ang - w);
    const [x2, y2] = P(40, ang + w);
    const [x3, y3] = P(55, ang);
    return (
      <path
        key={`r${i}`}
        d={`M${f(x1)} ${f(y1)}L${f(x3)} ${f(y3)}L${f(x2)} ${f(y2)}Z`}
        fill={a}
        opacity={i % 2 ? 0.55 : 0.95}
      />
    );
  });
  return (
    <>
      {beams}
      <circle cx={C} cy={C} r={40.5} fill="none" stroke={s} strokeWidth={1} opacity={0.5} />
    </>
  );
}
function knot(a: string, s: string): ReactNode {
  const rings = Array.from({ length: 12 }, (_, i) => {
    const [x, y] = P(46, (i * 360) / 12);
    return (
      <circle
        key={`k${i}`}
        cx={f(x)}
        cy={f(y)}
        r={4.6}
        fill="none"
        stroke={a}
        strokeWidth={1.5}
        opacity={0.92}
      />
    );
  });
  return (
    <>
      <circle cx={C} cy={C} r={51} fill="none" stroke={a} strokeWidth={2.4} />
      <circle cx={C} cy={C} r={41} fill="none" stroke={s} strokeWidth={1} opacity={0.5} />
      {rings}
    </>
  );
}

const MOTIF: Record<SealMotif, (a: string, s: string) => ReactNode> = {
  gearStar,
  starRing,
  laurel,
  gear,
  rays,
  knot,
};

/**
 * The National Corporation seal — a circular state-enterprise emblem: a per-
 * country motif ring (star-and-cog, star ring, laurel garter, industrial gear,
 * sunburst, interlace knot) around a gradient medallion bearing the national
 * glyph or monogram. Used as the corp avatar on the masthead and (smaller) as an
 * inline authority mark / badge.
 *
 * Pure SVG: resolution-independent, zero image assets. The medallion gradient and
 * accent come from `NATIONAL_IDENTITY` (fixed per-country brand colors, not theme
 * tokens) so the seal looks the same in every theme. Original geometry only — no
 * official coats of arms.
 */
export function NationalSeal({
  country,
  size = 64,
  glyph,
  serif,
  motif,
  className = "",
}: NationalSealProps) {
  const id = getNationalIdentity(country);
  const sealGlyph = glyph ?? id.glyph;
  const isCjk = (serif ?? id.serif) === "cjk";
  const ring = MOTIF[motif ?? id.motif](id.accent, id.accentSoft);
  // Center glyph sizing in viewBox units: a single CJK fills the medallion;
  // multi-char monograms shrink to fit.
  const fontSize = isCjk ? 30 : sealGlyph.length >= 2 ? 20 : 28;
  const fontFamily = isCjk ? SERIF_CJK : SERIF_MONO;
  // Stable gradient id (depends only on country colors, which are identical for
  // any seal of the same country — safe to share if two render on one page).
  const gradId = `ahd-seal-${country}-${Math.round(size)}`;

  return (
    <svg
      role="img"
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 120 120"
      className={`shrink-0 ${className}`}
      style={{ filter: "drop-shadow(0 6px 16px rgba(0,0,0,0.45))" }}
    >
      <defs>
        <radialGradient id={gradId} cx="42%" cy="34%" r="72%">
          <stop offset="0%" stopColor={lightenHex(id.palette[0], 26, 16, 16)} />
          <stop offset="60%" stopColor={id.palette[0]} />
          <stop offset="100%" stopColor={id.palette[1]} />
        </radialGradient>
      </defs>
      {ring}
      <circle cx={60} cy={60} r={34} fill={`url(#${gradId})`} stroke={id.accent} strokeWidth={2} />
      <circle
        cx={60}
        cy={60}
        r={30}
        fill="none"
        stroke={hexToRgba(id.accentSoft, 0.4)}
        strokeWidth={1}
      />
      <text
        x={60}
        y={60}
        dy="0.36em"
        textAnchor="middle"
        fontFamily={fontFamily}
        fontWeight={900}
        fontSize={fontSize}
        letterSpacing={isCjk ? undefined : "-0.02em"}
        fill={id.accentSoft}
      >
        {sealGlyph}
      </text>
    </svg>
  );
}

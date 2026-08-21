/**
 * Every play's worth in the ONE unit that decides the crisis: index points.
 *
 * A play on an institution moves the index by `magnitude x multiplier x weight
 * / 10`. A settlement-level play moves it by `magnitude x multiplier` outright,
 * because adding the same delta to all four institutions moves their weighted
 * mean by exactly that delta. Those two are not comparable at face value, which
 * is how a 5.0 settlement play came to be worth three times an 8.0 one.
 */
import {
  HUNDREDTHS,
  SETTLEMENT_PLAYS,
  TOTAL_INSTITUTION_WEIGHT,
  getInstitution,
  getSeat,
  PERSONAL_MULTIPLIER_PCT,
} from "../../src/lib/constants/settlementCrisis";

interface Row {
  id: string;
  seat: string;
  target: string;
  mag: number;
  mult: number;
  index: number;
  ap: number;
  cap: number;
  perAp: number;
  perCap: number;
}

const rows: Row[] = SETTLEMENT_PLAYS.map((p) => {
  const mult = (p.seat ? (getSeat(p.seat)?.multiplierPct ?? 100) : PERSONAL_MULTIPLIER_PCT) / 100;
  const weight = p.target ? (getInstitution(p.target)?.weight ?? 0) : TOTAL_INSTITUTION_WEIGHT;
  const mag = p.magnitude / HUNDREDTHS;
  const index = (mag * mult * weight) / TOTAL_INSTITUTION_WEIGHT;
  return {
    id: p.id,
    seat: p.seat ?? "personal",
    target: p.target ?? "SETTLEMENT",
    mag,
    mult,
    index: Math.round(index * 100) / 100,
    ap: p.actionCost,
    cap: p.capitalCost,
    perAp: Math.round((index / p.actionCost) * 100) / 100,
    perCap: p.capitalCost ? Math.round((index / p.capitalCost) * 1000) / 1000 : Infinity,
  };
});

rows.sort((a, b) => b.perAp - a.perAp);

console.log(
  "play           seat      target       mag  mult  INDEX   AP  cap  index/AP  index/cap"
);
for (const r of rows) {
  console.log(
    `${r.id.padEnd(14)} ${r.seat.padEnd(9)} ${r.target.padEnd(12)} ${String(r.mag).padStart(4)} ` +
      `${r.mult.toFixed(2)}  ${r.index.toFixed(2).padStart(5)}  ${String(r.ap).padStart(2)}  ` +
      `${String(r.cap).padStart(3)}  ${r.perAp.toFixed(2).padStart(8)}  ` +
      `${r.perCap === Infinity ? "     free" : r.perCap.toFixed(3).padStart(9)}`
  );
}

const seatRows = rows.filter((r) => r.seat !== "personal");
const best = seatRows[0];
const median = [...seatRows].sort((a, b) => a.perAp - b.perAp)[Math.floor(seatRows.length / 2)];
console.log(
  `\nbest index/AP: ${best.id} at ${best.perAp} — ${(best.perAp / median.perAp).toFixed(1)}x the median seat play (${median.id}, ${median.perAp})`
);

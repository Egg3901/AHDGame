/**
 * Sets `SETTLEMENT_CAPITAL_K` — the dial that prices a play paid in political
 * capital instead of the national treasury.
 *
 * Method mirrors `gq-play-efficiency`: a play's worth is its INDEX value,
 * `magnitude x multiplier x weight / TOTAL_WEIGHT`, which is the only unit the
 * four seats share. Funds costs cannot be compared across seats at all — they
 * are authored in four different currencies — so the capital price is derived
 * from the play's authored magnitude in mockup points.
 *
 * Tempo-independent on purpose. `mag()` DIVIDES authored points by
 * SETTLEMENT_TEMPO, so pricing off the stored magnitude would make capital
 * prices move with the speed dial while cash prices (literal 12M) stay put,
 * and the two routes would drift apart every time the tempo changed.
 * Multiplying the tempo back out recovers the authored point value.
 *
 * The criterion for k: a play bought with capital must not be BETTER value per
 * capital point than the play that seat already buys with capital alone. If it
 * is, the existing free play is obsolete and the catalogue has lost an option
 * rather than gained one.
 */
import {
  HUNDREDTHS,
  SETTLEMENT_CAPITAL_K,
  SETTLEMENT_PLAYS,
  SETTLEMENT_TEMPO,
  TOTAL_INSTITUTION_WEIGHT,
  getInstitution,
  getSeat,
} from "../../src/lib/constants/settlementCrisis";

/**
 * Seat capital income BEFORE the raise that shipped alongside this route,
 * against the live values. Kept so the cadence table still shows what the raise
 * bought; everything else reads the shipped constants.
 */
const INCOME_BEFORE: Record<string, number> = { DD: 6, RU: 3, US: 3, UK: 3 };
const incomeNow = (seatId: string) => getSeat(seatId as never)?.capitalPerTurn ?? 0;

const K_SWEEP = [1, 1.5, 2, 2.5, 3, 4, 5];

/** The authored mockup points, recovered from the tempo-scaled store. */
function authoredPoints(magnitude: number): number {
  return (magnitude * SETTLEMENT_TEMPO) / HUNDREDTHS;
}

/** Index points this play moves the settlement by. */
function indexValue(play: (typeof SETTLEMENT_PLAYS)[number]): number {
  const mult = (play.seat ? (getSeat(play.seat)?.multiplierPct ?? 100) : 100) / 100;
  const weight = play.target
    ? (getInstitution(play.target)?.weight ?? 0)
    : TOTAL_INSTITUTION_WEIGHT;
  return (((play.magnitude / HUNDREDTHS) * mult * weight) / TOTAL_INSTITUTION_WEIGHT) * 1;
}

function capitalPrice(play: (typeof SETTLEMENT_PLAYS)[number], k: number): number {
  return play.capitalCost + Math.round(authoredPoints(play.magnitude) * k);
}

const seatPlays = SETTLEMENT_PLAYS.filter((p) => p.seat !== null);
const paid = seatPlays.filter((p) => p.fundsCost > 0);
const capitalOnly = seatPlays.filter((p) => p.fundsCost === 0);

// ── the benchmark each seat's capital route must not beat ────────────────────
console.log("BENCHMARK — the capital-only play each seat already has\n");
console.log("seat  play          index   cap   index/cap");
const benchmark: Record<string, number> = {};
for (const p of capitalOnly) {
  const idx = indexValue(p);
  const perCap = idx / p.capitalCost;
  benchmark[p.seat!] = perCap;
  console.log(
    `${p.seat!.padEnd(5)} ${p.id.padEnd(13)} ${idx.toFixed(3).padStart(5)} ` +
      `${String(p.capitalCost).padStart(5)}   ${perCap.toFixed(4)}`
  );
}

// ── sweep ────────────────────────────────────────────────────────────────────
console.log("\n\nSWEEP — index/cap of each paid play bought with capital");
console.log("(marked ** where it BEATS that seat's benchmark = benchmark obsolete)\n");

const header = ["play", "seat", "index", ...K_SWEEP.map((k) => `k=${k}`)];
console.log(
  header[0].padEnd(12) +
    header[1].padEnd(5) +
    header[2].padStart(6) +
    "   " +
    K_SWEEP.map((k) => `k=${k}`.padStart(9)).join("")
);

for (const p of paid) {
  const idx = indexValue(p);
  const cells = K_SWEEP.map((k) => {
    const price = capitalPrice(p, k);
    const perCap = idx / price;
    const beats = perCap > benchmark[p.seat!];
    return `${perCap.toFixed(4)}${beats ? "**" : "  "}`.padStart(9);
  });
  console.log(
    p.id.padEnd(12) + p.seat!.padEnd(5) + idx.toFixed(3).padStart(6) + "   " + cells.join("")
  );
}

// ── how many plays each k obsoletes ──────────────────────────────────────────
console.log("\n\nVERDICT — plays whose capital route beats the seat's own benchmark\n");
for (const k of K_SWEEP) {
  const broken = paid.filter((p) => indexValue(p) / capitalPrice(p, k) > benchmark[p.seat!]);
  const flag = broken.length === 0 ? "OK  " : "BAD ";
  const shipped = k === SETTLEMENT_CAPITAL_K ? "  <- SHIPPED" : "";
  console.log(
    `${flag} k=${String(k).padEnd(4)} ${broken.length}/9 obsolete` +
      (broken.length ? `  (${broken.map((p) => p.id).join(", ")})` : "") +
      shipped
  );
}

// ── cadence: turns a debt-bound seat waits for its CHEAPEST capital option ───
const K_PICK = Number(process.argv[2] ?? SETTLEMENT_CAPITAL_K);
console.log(`\n\nCADENCE at k=${K_PICK} — a seat that will not borrow\n`);
console.log("seat  cheapest option   cap   before raise   at live income");
for (const seatId of ["DD", "RU", "US", "UK"]) {
  const options = seatPlays
    .filter((p) => p.seat === seatId)
    .map((p) => ({
      id: p.id,
      cap: p.fundsCost > 0 ? capitalPrice(p, K_PICK) : p.capitalCost,
    }))
    .sort((a, b) => a.cap - b.cap);
  const best = options[0];
  console.log(
    `${seatId.padEnd(5)} ${best.id.padEnd(17)} ${String(best.cap).padStart(3)}   ` +
      `${(best.cap / INCOME_BEFORE[seatId]).toFixed(1).padStart(12)}   ` +
      `${(best.cap / incomeNow(seatId)).toFixed(1).padStart(14)}`
  );
}

console.log(
  `\nSETTLEMENT_TEMPO=${SETTLEMENT_TEMPO}. Capital prices above are tempo-independent;\n` +
    `index values are tempo-scaled, so index/cap ratios shift with tempo but\n` +
    `their ORDERING — which is what k is chosen on — does not.`
);

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, sep } from "path";

/**
 * THE CAPACITY-PRICING GUARD.
 *
 * Capacity is priced at the revenue-per-unit of the strategy it will run, so
 * `capacityPricePerUnit` and `computeBuildCost` both take a `strategyId`. The
 * type system already forces a value to be PASSED — both parameters are
 * required — but it cannot force the RIGHT value, and `null` is a legal answer
 * that silently reinstates the old sector-type-default pricing.
 *
 * That is the whole defect this file exists to prevent returning: the build
 * price read the type's default mix while revenue read the sector's actual
 * strategy, a 326.9x gap for `extraction`/`rare_earth_mining` that let a plant
 * repay its capex in 0.22 turns instead of 72.
 *
 * So every call site is registered here with the strategy it passes and why.
 * `null` is legitimate in exactly one situation — the sector does not exist
 * yet, so it will be founded on the sector-type default — and every `null`
 * below states that. A new call site, or an existing one changing which
 * strategy it passes, fails this test until somebody writes down which it is.
 *
 * It is deliberately a REGISTRY plus a repo grep rather than a type-level rule:
 * `string | null` cannot distinguish "the default, deliberately" from "I did
 * not think about it".
 */

type Expectation = "sector" | "null-greenfield" | "null-derived";

/**
 * file → how many calls it makes and what they pass.
 *
 *   "sector"          — passes the sector's own `strategyId`. The default and
 *                       correct answer for anything pricing an EXISTING sector.
 *   "null-greenfield" — no sector exists yet; it will be founded on the
 *                       sector-type default, and the quote must match.
 *   "null-derived"    — the units being priced were themselves derived at the
 *                       default mix, so both legs must read the same mix or the
 *                       units and their price disagree.
 */
const REGISTRY: Record<string, { count: number; expect: Expectation; why: string }> = {
  "src/lib/constants/capacityEconomy.ts": {
    count: 1,
    expect: "sector",
    why: "computeBuildCost forwards its own required strategyId to capacityPricePerUnit.",
  },
  "src/lib/corporations/sectorProfitBasis.ts": {
    count: 1,
    expect: "sector",
    why: "The list-price fallback for a sector's owned capacity must read the same strategy its nameplate revenue does.",
  },
  "src/lib/corporations/capacityCapture.ts": {
    count: 3,
    expect: "sector",
    why: "Attack book transfer and the attack price floor value real, existing plants on both sides.",
  },
  "src/lib/corporations/commands/sectorOperations/buildCapacity.ts": {
    count: 1,
    expect: "sector",
    why: "The player build command. This is the site the exploit was bought through.",
  },
  "src/lib/corporations/commands/sectorOperations/expandSector.ts": {
    count: 1,
    expect: "null-greenfield",
    why: "Founds a new sector; expandSector never sets a strategyId, so it runs the sector-type default.",
  },
  "src/lib/corporations/queries/sectorDetailSections.ts": {
    count: 1,
    expect: "sector",
    why: "The build quote a player is shown. Must equal what buildCapacity charges.",
  },
  "src/app/api/corporations/[id]/expand-suggestions/route.ts": {
    count: 1,
    expect: "null-greenfield",
    why: "Suggests founding a sector that does not exist yet.",
  },
  "src/lib/economy/soe.ts": {
    count: 1,
    expect: "sector",
    why: "SOE capacity replacement cost, priced per existing sector.",
  },
  "src/lib/market/plantsTransition.ts": {
    count: 1,
    expect: "sector",
    why: "Flip-turn growth credit converts accrued spend into capacity for an existing sector.",
  },
  "src/lib/nationalization/nationalizeSectorWide.ts": {
    count: 1,
    expect: "null-derived",
    why: "Units come from computeSectorImpliedUnits at a null strategy; both legs must use the same mix.",
  },
  "src/lib/nationalization/soeOperations.ts": {
    count: 1,
    expect: "sector",
    why: "SOE directed-capex buys capacity in existing sectors.",
  },
  "src/lib/turn/commandEconomyTurn.ts": {
    count: 1,
    expect: "sector",
    why: "Directed credit buys capacity in existing sectors at the standing list price.",
  },
  "src/lib/turn/corporation/sectorBuildQueueTurn.ts": {
    count: 1,
    expect: "sector",
    why: "Prices the flip-turn growth credit for an existing sector.",
  },
  "src/lib/turn/nppCorporationBehavior.ts": {
    count: 3,
    expect: "sector",
    why: "One greenfield founding quote (null) and two growth quotes on existing sectors; see the per-call assertions below.",
  },
  "src/lib/migrations/entries/2026-09-07-reprice-strategy-capacity.ts": {
    count: 1,
    expect: "sector",
    why: "Re-prices existing capacity against the strategy the sector actually runs. HELD out of the auto-run chain pending a scope decision.",
  },
};

/** Call sites that legitimately pass `null` even though their file is 'sector'. */
const PER_CALL_NULL_EXCEPTIONS: Record<string, number> = {
  // NPP greenfield founding quote + its starter order.
  "src/lib/turn/nppCorporationBehavior.ts": 1,
};

const ROOT = join(__dirname, "..", "..", "..");
const SRC = join(ROOT, "src");
const CALL = /\b(?:capacityPricePerUnit|computeBuildCost)\s*\(/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/**
 * Blank out comments and string literals, preserving offsets and line count.
 *
 * Without this the scan matches prose: `expand-suggestions/route.ts` carries a
 * comment reading "computeBuildCost({ founding: true })", which registered as a
 * second, strategy-less call site that does not exist. Replacing with spaces
 * rather than deleting keeps every index valid for `argsAt`.
 */
function stripCommentsAndStrings(src: string): string {
  const out = src.split("");
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === "//") {
      const end = src.indexOf("\n", i);
      blank(i, end === -1 ? src.length : end);
      i = end === -1 ? src.length : end;
    } else if (two === "/*") {
      const end = src.indexOf("*/", i + 2);
      blank(i, end === -1 ? src.length : end + 2);
      i = end === -1 ? src.length : end + 2;
    } else if (src[i] === '"' || src[i] === "'" || src[i] === "`") {
      const quote = src[i];
      let k = i + 1;
      while (k < src.length && src[k] !== quote) k += src[k] === "\\" ? 2 : 1;
      blank(i + 1, k);
      i = k + 1;
    } else {
      i++;
    }
  }
  return out.join("");
}

/** Text of the call's argument list, by counting parens from `open`. */
function argsAt(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if ("([{".includes(src[i])) depth++;
    else if (")]}".includes(src[i])) {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return "";
}

/** Split a call's argument text on top-level commas. */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

interface Call {
  fn: "capacityPricePerUnit" | "computeBuildCost";
  args: string;
}

describe("capacity pricing call-site registry", () => {
  const found = new Map<string, Call[]>();
  for (const file of walk(SRC)) {
    const rel = file
      .slice(ROOT.length + 1)
      .split(sep)
      .join("/");
    const src = stripCommentsAndStrings(readFileSync(file, "utf8"));
    // The definitions themselves are not call sites.
    const calls: Call[] = [];
    for (const m of src.matchAll(CALL)) {
      const open = m.index! + m[0].length - 1;
      const args = argsAt(src, open);
      // Skip the declarations (`export function capacityPricePerUnit(` etc.).
      if (/^\s*sectorType\s*:\s*CorporationType/.test(args)) continue;
      if (/^\s*inputs\s*:\s*BuildCostInputs/.test(args)) continue;
      calls.push({
        fn: m[0].startsWith("compute") ? "computeBuildCost" : "capacityPricePerUnit",
        args,
      });
    }
    if (calls.length > 0) found.set(rel, calls);
  }

  it("has no unregistered capacity-pricing call site", () => {
    const unregistered = [...found.keys()].filter((f) => !(f in REGISTRY));
    expect(
      unregistered,
      `unregistered capacity-pricing call sites: ${unregistered.join(", ")}`
    ).toEqual([]);
  });

  it("has no stale registry entry", () => {
    const stale = Object.keys(REGISTRY).filter((f) => !found.has(f));
    expect(stale, `registry lists files with no call site: ${stale.join(", ")}`).toEqual([]);
  });

  it("registers the right number of calls per file", () => {
    for (const [file, calls] of found) {
      expect(calls.length, `${file} call count changed`).toBe(REGISTRY[file]?.count);
    }
  });

  it("passes a strategy argument at every call site", () => {
    for (const [file, calls] of found) {
      for (const call of calls) {
        if (call.fn === "capacityPricePerUnit") {
          // Positional: the 4th argument IS the strategy. A 3-arg call is the
          // old, strategy-blind signature and would not compile, but this
          // catches it at the source level too.
          expect(
            splitTopLevel(call.args).length,
            `${file}: capacityPricePerUnit needs 4 arguments, got ${splitTopLevel(call.args).length}`
          ).toBe(4);
        } else {
          expect(
            /\bstrategyId\s*:/.test(call.args),
            `${file}: computeBuildCost is missing a strategyId key`
          ).toBe(true);
        }
      }
    }
  });

  it("only passes a bare null where the registry says the sector does not exist yet", () => {
    for (const [file, calls] of found) {
      const entry = REGISTRY[file];
      const nulls = calls.filter((c) => {
        if (c.fn === "computeBuildCost") return /\bstrategyId\s*:\s*null\b/.test(c.args);
        const parts = splitTopLevel(c.args);
        return parts.length === 4 && parts[3].trim() === "null";
      });
      if (entry.expect === "sector") {
        const allowed = PER_CALL_NULL_EXCEPTIONS[file] ?? 0;
        expect(
          nulls.length,
          `${file} passes a bare null at ${nulls.length} call(s) but is registered 'sector' (${entry.why})`
        ).toBeLessThanOrEqual(allowed);
      } else {
        expect(
          nulls.length,
          `${file} is registered ${entry.expect} but passes no null (${entry.why})`
        ).toBeGreaterThan(0);
      }
    }
  });
});

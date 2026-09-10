import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Turn-path reads of the fat collections must project.
 *
 * A turn's CPU is mostly BSON decoding, and three collections dominate it:
 * an NPP is 31 KB (30 KB of which is `policies.domainPositions`), a corporate
 * sector is 2.5 KB (45% `buildQueue` + `plantsPnl`), a legislation type is
 * 2.4 KB (`policyOptions`). Reading them in full "because it is simpler" is
 * how the 2026-09 turn got to 436 MB of BSON per turn; projecting brought it
 * to 168 MB. This test keeps it that way: every `.find(` on these collections
 * in turn-path code must either carry a projection or be marked, on one of
 * the four lines above the `.collection(` call, with
 *
 *   // full-read(<collection>): <why every field is needed>
 *
 * so the next reader sees the reason instead of a silent 30 KB-per-row cost.
 * Measure with `AHD_TURN_ROUNDTRIP_PROFILE=1 npx tsx scripts/perf/one-turn.ts`.
 */

const FAT_COLLECTIONS = ["npps", "corporateSectors", "legislationTypes"] as const;

/** Directories that only the turn reaches, plus hot helpers the turn calls. */
const TURN_PATH_ROOTS = ["src/lib/turn", "src/simulation"];
const TURN_PATH_FILES = [
  "src/lib/turnSystem.ts",
  "src/lib/moneySupply/snapshot.ts",
  "src/lib/cabinetNominationLifecycle.ts",
  "src/lib/nationalization/soeOperations.ts",
  "src/lib/nationalization/soeRemittance.ts",
  "src/lib/budget/publicEnterpriseRevenue.ts",
  "src/lib/economy/economicVitalSigns.ts",
  "src/lib/corporations/marketShare.ts",
  "src/lib/indexFunds/fundCron.ts",
  "src/lib/indexFunds/nppInvesting.ts",
  "src/lib/ledger/balanceSnapshot.ts",
];

const READ_PATTERN = new RegExp(
  `\\.collection(?:<[^>]*>)?\\("(${FAT_COLLECTIONS.join("|")})"\\)\\s*\\.find\\(`,
  "g"
);
const MARKER = /full-read\((npps|corporateSectors|legislationTypes)\)/;

function listSourceFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "test-utils") continue;
      out.push(...listSourceFiles(full));
    } else if (full.endsWith(".ts") && !full.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

interface Violation {
  file: string;
  line: number;
  collection: string;
}

/** True when the chained statement starting at `from` carries a projection. */
function hasProjection(source: string, from: number): boolean {
  const tail = source.slice(from, from + 2000);
  const end = tail.search(/\.toArray\(\)|\.next\(\)|\.forEach\(|for await|;\s*\n/);
  const statement = end === -1 ? tail : tail.slice(0, end);
  return /projection\s*:|\.project\s*[<(]/.test(statement);
}

function isMarked(lines: string[], lineIndex: number, collection: string): boolean {
  for (let i = Math.max(0, lineIndex - 4); i <= lineIndex; i++) {
    const m = MARKER.exec(lines[i] ?? "");
    if (m && m[1] === collection) return true;
  }
  return false;
}

export function findUnprojectedFatReads(repoRoot: string): Violation[] {
  const files = [
    ...TURN_PATH_ROOTS.flatMap((root) => listSourceFiles(join(repoRoot, root))),
    ...TURN_PATH_FILES.map((f) => join(repoRoot, f)),
  ];
  const violations: Violation[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const lines = source.split("\n");
    for (const match of source.matchAll(READ_PATTERN)) {
      const collection = match[1]!;
      const lineIndex = source.slice(0, match.index).split("\n").length - 1;
      if (hasProjection(source, match.index! + match[0].length)) continue;
      if (isMarked(lines, lineIndex, collection)) continue;
      violations.push({ file: relative(repoRoot, file), line: lineIndex + 1, collection });
    }
  }
  return violations;
}

describe("turn-path reads of fat collections", () => {
  it("project, or say why they need the whole document", () => {
    const violations = findUnprojectedFatReads(process.cwd());
    const report = violations.map((v) => `  ${v.file}:${v.line}  ${v.collection}`).join("\n");
    expect(
      violations,
      `Unprojected reads of fat collections on the turn path:\n${report}\n` +
        `Add a projection, or a "// full-read(<collection>): <reason>" comment above the read.`
    ).toEqual([]);
  });
});

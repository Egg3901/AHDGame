import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";

/**
 * THE TREASURY-WRITER REGISTRY.
 *
 * The helpers in `nationalization/treasury.ts` move `federalBudget.treasuryBalance`
 * with a raw increment. The shadow ledger only sees that cash if somebody
 * witnesses it, and there are three honest ways to do so:
 *
 *   - `built-in`: the helper witnesses every landed leg itself (state-enterprise
 *     remittance, draws, loss backing and capex grants);
 *   - `flow`: the caller opts into the helper's government-side witness, pairing it
 *     with its own counterparty row under one reason;
 *   - `own-row`: the caller already emits a government-subject financial row,
 *     so a helper witness would book the treasury twice.
 *
 * Anything else is a known gap and must name the issue tracking it. A new
 * caller fails this test until somebody writes down which of these it is.
 */
type Classification =
  | { kind: "built-in" }
  | { kind: "flow"; flows: string[] }
  | { kind: "own-row"; txTypes: string[] }
  | { kind: "gap"; issue: string; note: string };

interface Registered {
  writers: string[];
  witness: Classification[];
}

const REGISTRY: Record<string, Registered> = {
  "src/lib/nationalization/soeOperations.ts": {
    writers: ["coverSoeOperatingLoss", "debitTreasurySoeCapex"],
    witness: [{ kind: "built-in" }],
  },
  "src/lib/nationalization/soeRemittance.ts": {
    writers: ["remitToTreasury"],
    witness: [{ kind: "built-in" }],
  },
  "src/app/api/country/[code]/national-corporation/[id]/treasury-draw/route.ts": {
    writers: ["drawFromTreasury"],
    witness: [{ kind: "built-in" }],
  },
  "src/lib/nationalization/nationalizeSectorWide.ts": {
    writers: ["debitTreasuryCompensation"],
    witness: [{ kind: "flow", flows: ["nationalization_compensation"] }],
  },
  "src/lib/nationalization/ownershipTransition.ts": {
    writers: ["debitTreasuryCompensation", "creditTreasuryProceeds"],
    witness: [
      { kind: "flow", flows: ["nationalization_compensation"] },
      { kind: "own-row", txTypes: ["share_buyout_payout"] },
      {
        kind: "gap",
        issue: "#2983",
        note: "whole-corporation payout pool and recouped corporate cash",
      },
    ],
  },
  "src/lib/corporations/groups/applyGroupRelief.ts": {
    writers: ["debitTreasury"],
    witness: [{ kind: "flow", flows: ["group_loss_relief"] }],
  },
  "src/lib/corporations/groups/applyTransferPricingAudit.ts": {
    writers: ["creditTreasuryProceedsFromAnchor"],
    witness: [{ kind: "flow", flows: ["regulatory_fine"] }],
  },
  "src/lib/corporations/mergerReview/lifecycle.ts": {
    writers: ["creditTreasuryProceedsFromAnchor"],
    witness: [{ kind: "flow", flows: ["regulatory_fine"] }],
  },
  "src/lib/corporations/subsidiaries/commands/spinOff.ts": {
    writers: ["creditTreasuryProceeds"],
    witness: [{ kind: "own-row", txTypes: ["gov_tax_revenue"] }],
  },
  "src/lib/indexFunds/sponsorship/charterFund.ts": {
    writers: ["creditTreasuryProceeds"],
    witness: [{ kind: "own-row", txTypes: ["gov_tax_revenue"] }],
  },
  "src/app/api/corporations/route.ts": {
    writers: ["creditTreasuryProceeds"],
    witness: [{ kind: "own-row", txTypes: ["corp_capital_seed"] }],
  },
  "src/lib/indexFunds/petitions/service.ts": {
    writers: ["creditTreasuryProceedsFromAnchor"],
    witness: [{ kind: "own-row", txTypes: ["index_listing_lobbying"] }],
  },
  "src/lib/nationalization/privatizeAsset.ts": {
    writers: ["creditTreasuryProceeds"],
    witness: [{ kind: "gap", issue: "#2983", note: "IPO float proceeds" }],
  },
  "src/lib/nationalization/privatizationAuction.ts": {
    writers: ["creditTreasuryProceeds"],
    witness: [{ kind: "gap", issue: "#2983", note: "auction proceeds from escrow" }],
  },
};

const WRITER = new RegExp(
  "\\b(" +
    [
      "debitTreasuryCompensation",
      "debitTreasury",
      "creditTreasuryProceedsFromAnchor",
      "creditTreasuryProceeds",
      "coverSoeOperatingLoss",
      "debitTreasurySoeCapex",
      "drawFromTreasury",
      "remitToTreasury",
    ].join("|") +
    ")\\s*\\(",
  "g"
);
const IMPORTS_TREASURY = /from\s+["'](?:@\/lib\/nationalization\/treasury|\.{1,2}\/treasury)["']/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const ROOT = join(__dirname, "..", "..", "..");
const callers = new Map<string, string[]>();
for (const file of sourceFiles(join(ROOT, "src"))) {
  const text = readFileSync(file, "utf8");
  if (!IMPORTS_TREASURY.test(text)) continue;
  const writers = [...new Set([...text.matchAll(WRITER)].map((match) => match[1]))].sort();
  if (writers.length > 0) callers.set(relative(ROOT, file).split(sep).join("/"), writers);
}

describe("treasury writer registry", () => {
  it("classifies every caller of a nationalization treasury writer", () => {
    expect(Object.fromEntries(callers)).toEqual(
      Object.fromEntries(
        Object.entries(REGISTRY).map(([file, entry]) => [file, [...entry.writers].sort()])
      )
    );
  });

  it.each(Object.entries(REGISTRY))("%s carries its declared witness", (file, entry) => {
    const text = readFileSync(join(ROOT, file), "utf8");
    for (const witness of entry.witness) {
      if (witness.kind === "flow") {
        for (const flow of witness.flows) expect(text).toContain(`flow: "${flow}"`);
      } else if (witness.kind === "own-row") {
        for (const txType of witness.txTypes) expect(text).toContain(`"${txType}"`);
      } else if (witness.kind === "gap") {
        expect(witness.issue).toMatch(/^#\d+$/);
      }
    }
  });
});

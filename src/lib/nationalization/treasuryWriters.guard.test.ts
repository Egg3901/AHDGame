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
    writers: ["debitTreasuryCompensation", "creditTreasuryProceedsFromAnchor"],
    witness: [
      {
        kind: "flow",
        flows: [
          "nationalization_compensation",
          "nationalization_buyout_pool",
          "nationalization_buyout_float",
          "corporation_liquidation",
        ],
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
    witness: [{ kind: "flow", flows: ["index_listing_lobbying"] }],
  },
  "src/lib/nationalization/privatizeAsset.ts": {
    writers: ["creditTreasuryProceeds"],
    witness: [{ kind: "flow", flows: ["privatization_ipo"] }],
  },
  "src/lib/nationalization/privatizationAuction.ts": {
    writers: ["creditTreasuryProceeds"],
    witness: [{ kind: "flow", flows: ["privatization_auction_proceeds"] }],
  },
};

/**
 * The same classification for `budget/treasurySpend`, the canonical treasury mover
 * for crisis, settlement, world-event and extraction flows.
 */
const SPEND_REGISTRY: Record<string, Registered> = {
  "src/lib/crises/aidPledge.ts": {
    writers: ["spendFromTreasury"],
    witness: [{ kind: "flow", flows: ["crisis_aid"] }],
  },
  "src/lib/crises/aidFinalize.ts": {
    writers: ["creditTreasury"],
    witness: [{ kind: "flow", flows: ["crisis_aid"] }],
  },
  "src/lib/crises/interactionEngine.ts": {
    writers: ["spendFromTreasury"],
    witness: [{ kind: "flow", flows: ["crisis_response"] }],
  },
  "src/lib/crises/optionActions.ts": {
    writers: ["spendFromTreasury"],
    witness: [{ kind: "flow", flows: ["crisis_response"] }],
  },
  "src/lib/crises/unionBanStrike.ts": {
    writers: ["spendFromTreasury"],
    witness: [{ kind: "flow", flows: ["crisis_response"] }],
  },
  "src/lib/livingConflict/globalResponse.ts": {
    writers: ["spendFromTreasury"],
    witness: [{ kind: "flow", flows: ["crisis_response"] }],
  },
  "src/lib/settlement/commands/commitPlay.ts": {
    writers: ["spendFromTreasury"],
    witness: [{ kind: "flow", flows: ["settlement_play"] }],
  },
  "src/lib/settlement/mobilisation.ts": {
    writers: ["spendFromTreasury"],
    witness: [{ kind: "flow", flows: ["settlement_mobilisation"] }],
  },
  "src/lib/events/substrate/applyEffects.ts": {
    writers: ["creditTreasury", "spendFromTreasury"],
    witness: [{ kind: "own-row", txTypes: ["world_event_payout"] }],
  },
  "src/lib/extraction/commands/launchGovernmentProspect.ts": {
    writers: ["spendFromTreasury"],
    witness: [{ kind: "own-row", txTypes: ["govt_prospecting_cost"] }],
  },
  "src/lib/extraction/commands/acceptContractOffer.ts": {
    writers: ["creditTreasury"],
    witness: [{ kind: "own-row", txTypes: ["govt_signing_fee_receipt"] }],
  },
  "src/lib/turn/extraction/contractSettlement.ts": {
    writers: ["creditTreasury"],
    witness: [{ kind: "own-row", txTypes: ["govt_royalty_receipt"] }],
  },
};

const writerPattern = (names: string[]) => new RegExp("\\b(" + names.join("|") + ")\\s*\\(", "g");
const TREASURY_WRITER = writerPattern([
  "debitTreasuryCompensation",
  "debitTreasury",
  "creditTreasuryProceedsFromAnchor",
  "creditTreasuryProceeds",
  "coverSoeOperatingLoss",
  "debitTreasurySoeCapex",
  "drawFromTreasury",
  "remitToTreasury",
]);
const IMPORTS_TREASURY = /from\s+["'](?:@\/lib\/nationalization\/treasury|\.{1,2}\/treasury)["']/;
const SPEND_WRITER = writerPattern(["spendFromTreasury", "creditTreasury"]);
const IMPORTS_SPEND = /from\s+["']@\/lib\/budget\/treasurySpend["']/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const ROOT = join(__dirname, "..", "..", "..");
const SOURCES = sourceFiles(join(ROOT, "src")).map((file) => ({
  file: relative(ROOT, file).split(sep).join("/"),
  text: readFileSync(file, "utf8"),
}));

function callersOf(imports: RegExp, writer: RegExp): Record<string, string[]> {
  const callers: Record<string, string[]> = {};
  for (const { file, text } of SOURCES) {
    if (!imports.test(text)) continue;
    const writers = [...new Set([...text.matchAll(writer)].map((match) => match[1]))].sort();
    if (writers.length > 0) callers[file] = writers;
  }
  return callers;
}

function declaredWriters(registry: Record<string, Registered>): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(registry).map(([file, entry]) => [file, [...entry.writers].sort()])
  );
}

function expectDeclaredWitness(file: string, entry: Registered): void {
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
}

describe("treasury writer registry", () => {
  it("classifies every caller of a nationalization treasury writer", () => {
    expect(callersOf(IMPORTS_TREASURY, TREASURY_WRITER)).toEqual(declaredWriters(REGISTRY));
  });

  it.each(Object.entries(REGISTRY))("%s carries its declared witness", expectDeclaredWitness);

  it("classifies every caller of a treasury spend writer", () => {
    expect(callersOf(IMPORTS_SPEND, SPEND_WRITER)).toEqual(declaredWriters(SPEND_REGISTRY));
  });

  it.each(Object.entries(SPEND_REGISTRY))("%s carries its declared witness", expectDeclaredWitness);
});

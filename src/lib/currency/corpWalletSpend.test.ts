/**
 * Guards the client/server boundary that keeps `mongodb` out of the browser.
 *
 * `corporationCapital.ts` holds DB-backed FX loaders and therefore imports
 * `@/lib/db/collections/gameState` → `@/lib/mongodb` → `mongodb`. Two client
 * components (`BondTradeModal`, `SharePurchaseModal`) need two PURE helpers
 * that used to live alongside them, which dragged the whole driver into the
 * client graph and broke `next build`:
 *
 *   mongodb → lib/mongodb.ts → db/collections/gameState.ts
 *           → currency/corporationCapital.ts → BondTradeModal.tsx [client]
 *
 * A unit test cannot see a bundler graph, so this asserts the two structural
 * facts that keep it fixed. `next build` is the real check; this is the one
 * that fails in seconds instead of minutes.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { estimateCorpMaxSpendableTargetAmount, estimateCorpWalletSpend } from "./corpWalletSpend";

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), "src", rel), "utf8");

const CLIENT_CONSUMERS = [
  "app/bond/[id]/components/BondTradeModal.tsx",
  "components/corporation/shares/SharePurchaseModal.tsx",
];

describe("corpWalletSpend — client/server boundary", () => {
  it("imports nothing that reaches the database", () => {
    const src = read("lib/currency/corpWalletSpend.ts");
    const imports = src.split("\n").filter((l) => /^\s*(import|export)\s.*from\s+"/.test(l));
    for (const line of imports) {
      expect(line, "must not reach mongodb").not.toMatch(/@\/lib\/mongodb|from "mongodb"/);
      expect(line, "must not reach the db layer").not.toMatch(/@\/lib\/db\//);
      // Importing the server half back would re-create the exact cycle.
      expect(line, "must not import corporationCapital").not.toContain("corporationCapital");
    }
  });

  it("keeps the client components off the server-side module", () => {
    for (const rel of CLIENT_CONSUMERS) {
      const src = read(rel);
      expect(src, `${rel} must not import corporationCapital`).not.toContain(
        '"@/lib/currency/corporationCapital"'
      );
      expect(src, `${rel} should use the client-safe module`).toContain(
        '"@/lib/currency/corpWalletSpend"'
      );
    }
  });

  it("still re-exports both helpers from corporationCapital for server callers", () => {
    // ~135 server-side files import them from the old path; moving the
    // definitions must not have broken any of them.
    const src = read("lib/currency/corporationCapital.ts");
    expect(src).toContain("estimateCorpWalletSpend");
    expect(src).toContain("estimateCorpMaxSpendableTargetAmount");
    expect(src).toContain('from "@/lib/currency/corpWalletSpend"');
  });

  it("corporationCapital itself makes no RUNTIME import of the db layer", () => {
    // This is what actually fixed the build. Splitting the two pure helpers out
    // was not enough: client components reach corporationCapital indirectly too
    // (nationalization/concentration -> concentrationStatus -> NatRegisterTab),
    // so the file itself has to be free of runtime db imports. `import type` is
    // erased by the compiler and is therefore fine.
    const src = read("lib/currency/corporationCapital.ts");
    const runtimeImports = src
      .split(/\r?\n/)
      .filter((l) => /^\s*import\s/.test(l) && !/^\s*import\s+type\s/.test(l));
    for (const line of runtimeImports) {
      expect(line, "runtime import must not reach the db layer").not.toMatch(
        /@\/lib\/db\/collections|@\/lib\/mongodb|from "mongodb"/
      );
    }
  });

  it("behaviour is unchanged by the move", () => {
    // Same-currency and legacy paths return the raw balance.
    expect(
      estimateCorpMaxSpendableTargetAmount({
        availableBalance: 500,
        fromCurrency: "USD",
        toCurrency: "USD",
        rates: {},
      })
    ).toBe(500);
    expect(
      estimateCorpMaxSpendableTargetAmount({
        availableBalance: 0,
        fromCurrency: "USD",
        toCurrency: "GBP",
        rates: {},
      })
    ).toBe(0);

    // A non-positive requirement is trivially affordable.
    expect(
      estimateCorpWalletSpend({
        requiredAmount: 0,
        availableBalance: 100,
        rates: {},
      })
    ).toMatchObject({ canAfford: true, spendAmount: 0, remainingBalance: 100 });

    // No currency pair => straight spend, capped at the balance.
    expect(
      estimateCorpWalletSpend({
        requiredAmount: 250,
        availableBalance: 100,
        rates: {},
      })
    ).toMatchObject({ canAfford: false, spendAmount: 100, remainingBalance: 0 });
  });
});

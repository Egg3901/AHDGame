import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BlendMoneySection } from "./BlendMoneySection";
import type { MoneyVM } from "./campaignBlendViewModel";

const money: MoneyVM = {
  symbol: "$",
  incomeTotal: 50_000,
  groundUpkeep: 1_000,
  mediaUpkeep: 2_000,
  fundraisingUpkeep: 3_000,
  oppositionUpkeep: 0,
  fieldOfficeUpkeep: 12_000,
  expenseTotal: 18_000,
  net: 32_000,
  cumulative: { totalGenerated: 0, totalSpent: 0, actionsGenerated: 0, actionsSpent: 0 },
  sparkline: [],
  personalBalance: null,
  personalSymbol: "$",
  partyTreasury: null,
};

describe("campaign money breakdown", () => {
  it.each(["desktop", "mobile"] as const)(
    "shows geographic and strategic upkeep on %s",
    (variant) => {
      const noop = () => {};
      const html = renderToStaticMarkup(
        <BlendMoneySection
          money={money}
          variant={variant}
          canContribute={false}
          contribution={{ personalAmount: "", treasuryAmount: "", busy: false, error: null }}
          onPersonalAmount={noop}
          onTreasuryAmount={noop}
          onContributePersonal={noop}
          onContributeTreasury={noop}
        />
      );
      for (const [label, value] of [
        ["Fundraising upkeep", "3,000"],
        ["Ground game upkeep", "1,000"],
        ["Media upkeep", "2,000"],
        ["Field office upkeep", "12,000"],
        ["Total upkeep", "18,000"],
        ["Net", "32,000"],
      ]) {
        expect(html).toContain(label);
        expect(html).toContain(value);
      }
      expect(html).not.toContain("NaN");
    }
  );
});

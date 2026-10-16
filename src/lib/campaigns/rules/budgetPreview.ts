import type { Campaign } from "@/lib/db/types";
import { calculateCampaignIncome } from "../income";
import { calculateMaintenanceCosts } from "../maintenance";
import { getMaintenanceCost, getTreeMaintenanceCost, type UpgradeCategory } from "../upgradeCosts";
import { getFieldOfficeCostAnchor, getFieldOfficeRules } from "../fieldOffices/rules";

/** Read-only recurring flows, using the same conversion and rounding as upkeep. */
export function buildCampaignBudgetPreview(
  campaign: Campaign,
  election: { countryId: string; electionType?: string; status: string } | null,
  suspended: boolean,
  officeCount: number,
  toLocal: (anchor: number) => number
) {
  const dormant = campaign.status === "archived" || suspended;
  const electionType = election?.electionType;
  const maintenanceFor = (category: UpgradeCategory) => {
    if (dormant) return 0;
    const tree = campaign[`${category}Tree`];
    return toLocal(
      tree?.starter
        ? getTreeMaintenanceCost(category, tree, electionType)
        : getMaintenanceCost(category, campaign[`${category}Level`] ?? 0, electionType)
    );
  };
  const rules = election ? getFieldOfficeRules(election.countryId) : null;
  // Suspension stops strategic operations, but active-race geographic offices still charge.
  const fieldOfficeMaintenance =
    campaign.status !== "archived" && election?.status === "active" && rules
      ? officeCount * toLocal(getFieldOfficeCostAnchor(rules, electionType).upkeep)
      : 0;
  // Strategic upkeep rounds once; geographic upkeep rounds per office.
  const total =
    (dormant ? 0 : toLocal(calculateMaintenanceCosts(campaign, electionType))) +
    fieldOfficeMaintenance;
  const income = dormant ? 0 : toLocal(calculateCampaignIncome(campaign, electionType));
  return {
    income: { total: income },
    expenses: {
      fundraisingMaintenance: maintenanceFor("fundraising"),
      oppositionResearchMaintenance: maintenanceFor("oppositionResearch"),
      groundGameMaintenance: maintenanceFor("groundGame"),
      mediaSpendingMaintenance: maintenanceFor("mediaSpending"),
      fieldOfficeMaintenance,
      total,
    },
    netIncome: income - total,
  };
}

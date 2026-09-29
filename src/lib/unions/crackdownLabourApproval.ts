import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Character } from "@/lib/db/types";
import type { FederalBudget } from "@/lib/db/types/budget";
import { getHeadOfGovernmentCharacterId } from "@/lib/api/headOfGovernment";
import { segmentsFor } from "@/lib/crises/unionBanStrike";

/** A standing crackdown slowly costs the executive standing with labor voters. */
export const CRACKDOWN_LABOUR_APPROVAL_COST_PER_TURN = 0.25;

/** Charge each country's sitting executive once per turn while its ban is in crackdown posture. */
export async function processCrackdownLabourApprovalTurn(
  db: Db,
  currentTurn: number
): Promise<number> {
  const budgets = await db
    .collection<FederalBudget>("federalBudget")
    .find(
      { unionsBanned: true, unionEnforcementPosture: "crackdown" },
      { projection: { countryId: 1 } }
    )
    .toArray();
  let charged = 0;
  for (const budget of budgets) {
    if (!budget.countryId) continue;
    const countryId = budget.countryId as CountryId;
    const executiveId = await getHeadOfGovernmentCharacterId(db, countryId);
    if (!executiveId) continue;
    const marker = `lastUnionCrackdownApprovalTurn.${countryId}`;
    const set: Record<string, unknown> = { [marker]: currentTurn };
    for (const archetypeId of segmentsFor(countryId).labour) {
      set[`archetypeApprovals.${archetypeId}`] = {
        $max: [
          -100,
          {
            $subtract: [
              { $ifNull: [`$archetypeApprovals.${archetypeId}`, 0] },
              CRACKDOWN_LABOUR_APPROVAL_COST_PER_TURN,
            ],
          },
        ],
      };
    }
    const result = await db
      .collection<Character>("characters")
      .updateOne({ _id: executiveId, [marker]: { $ne: currentTurn } }, [{ $set: set }]);
    if (result.modifiedCount > 0) charged += 1;
  }
  return charged;
}

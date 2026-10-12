/** Fund investment and withdrawal actions use the same gates as their mutations. */
import type { Db, ObjectId } from "mongodb";
import type { IndexFund } from "@/lib/db/types";
import { bankFundAcceptsSubscriptions } from "./managerEligibility";
import { isIndexFundsFullMode } from "./featureFlag";
import { rejectDuringTurn } from "@/lib/api/rejectDuringTurn";
import { canRedeemSponsorUnits } from "./sponsorship/sponsorUnits";

export async function fundTradeCapabilities(
  db: Db,
  fund: IndexFund,
  viewer: { hasCharacter: boolean; units: number; corporationId?: ObjectId }
) {
  const enabled =
    viewer.hasCharacter &&
    (fund.mandate?.mode === "picked_stocks" || (await isIndexFundsFullMode()));
  const available = enabled && !(await rejectDuringTurn(db));
  return {
    canSubscribe: available && (await bankFundAcceptsSubscriptions(db, fund)),
    canRedeem:
      available &&
      fund.status !== "delisted" &&
      viewer.units > 0 &&
      (!viewer.corporationId || (await canRedeemSponsorUnits(db, fund, viewer.corporationId))),
  };
}

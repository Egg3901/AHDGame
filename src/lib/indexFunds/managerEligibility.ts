/** Active investment and universal bank charters can accept managed fund investments. */
import type { Db } from "mongodb";
import type { Corporation, IndexFund, GameConfig } from "@/lib/db/types";
import { isIndexFundsEnabled } from "./featureFlag";
import { bankMayManageFunds } from "./sponsorship/rules/eligibility";

export async function bankFundAcceptsSubscriptions(db: Db, fund: IndexFund): Promise<boolean> {
  if (fund.status !== "active") return false;
  if (fund.mandate?.mode !== "picked_stocks") return true;
  if (!fund.sponsorCorporationId) return false;
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { indexFundsMode: 1, indexFundsEnabled: 1 } });
  if (!(await isIndexFundsEnabled(config))) return false;
  const manager = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: fund.sponsorCorporationId }, { projection: { bankCharter: 1 } });
  return bankMayManageFunds(manager?.bankCharter);
}

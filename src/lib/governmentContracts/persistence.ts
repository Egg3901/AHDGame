/** Government tenders keep bids on the tender so closing, bidding and choosing one winner share an atomic document. */
import type { Db } from "mongodb";
import type { GovernmentTender } from "./types";
export function tenders(db: Db) {
  return db.collection<GovernmentTender>("governmentTenders");
}
export async function ensureGovernmentContractIndexes(db: Db) {
  await tenders(db).createIndex(
    { countryId: 1, status: 1, closesTurn: 1, _id: -1 },
    { name: "governmentTenders_country_status_close" }
  );
  await tenders(db).createIndex(
    { status: 1, awardDeadlineTurn: 1 },
    { name: "governmentTenders_expiry" }
  );
  await tenders(db).createIndex(
    { countryId: 1, "terms.type": 1, status: 1, _id: -1 },
    { name: "governmentTenders_country_type_status" }
  );
  await tenders(db).createIndex(
    { "terms.stateId": 1, "terms.resource": 1, status: 1 },
    { name: "governmentTenders_resource" }
  );
}

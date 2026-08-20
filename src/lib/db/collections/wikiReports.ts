import type { Db } from "mongodb";
import type { WikiReport } from "../types/wikiReport";

export function getWikiReportsCollection(db: Db) {
  return db.collection<WikiReport>("wikiReports");
}

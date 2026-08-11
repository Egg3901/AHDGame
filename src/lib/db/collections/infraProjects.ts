import type { Db } from "mongodb";
import type { InfraProject } from "@/lib/db/types/infraProject";

export function getInfraProjectsCollection(db: Db) {
  return db.collection<InfraProject>("infraProjects");
}

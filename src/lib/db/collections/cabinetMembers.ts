import type { Db } from "mongodb";
import type { UnifiedCabinetMember } from "../types/unifiedCabinetMember";

export function getCabinetMembersCollection(db: Db) {
  return db.collection<UnifiedCabinetMember>("cabinetMembers");
}

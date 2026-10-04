/**
 * Assembly offices keep stable identities across seating attempts and repeats.
 * russianAssemblyOfficialId binds an individual nomination to both original roots.
 */
import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
export function russianAssemblyOfficialId(seatingId: string, candidateId: string) {
  return new ObjectId(
    createHash("sha256").update(`${seatingId}:${candidateId}`).digest("hex").slice(0, 24)
  );
}

/** Group receiving consent follows the current corporation operator and recorded CEO tenure. */
import type { Corporation } from "@/lib/db/types";
import type { GroupOperator } from "./rules/participation";
export function groupOperator(c: Corporation, rootId: string): GroupOperator {
  return {
    id: c._id.toString(),
    rootId,
    ceoId: c.ceoId?.toString() ?? "",
    ceoTenureKey: JSON.stringify([
      c.ceoHistory?.length ?? 0,
      c.ceoHistory?.at(-1)?.startTurn ?? null,
      c.ceoHistory?.at(-1)?.endTurn ?? null,
    ]),
    userId: c.userId?.toString(),
    operator: c.ceoType === "npp" && !c.caretakerCeo ? "npp" : "player",
    vacant: c.ceoVacant === true || !c.ceoId || c.suspended === true,
    stateOwned: !!c.countryOwnerId,
  };
}

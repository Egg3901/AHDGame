import { requireConflictsEnabled } from "../_coldwar/gate";
import { HomeFrontBoard } from "../_coldwar/HomeFrontBoard";

// Politburo (East) — the domestic politics of the Party. Gated by
// `conflictsEnabled`. Reached from the Command Console East column.
export default async function PolitburoPage() {
  await requireConflictsEnabled();
  return <HomeFrontBoard side="east" />;
}

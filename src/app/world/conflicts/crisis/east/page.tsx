import { requireConflictsEnabled } from "../../_coldwar/gate";
import { CrisisBoard } from "../../_coldwar/CrisisBoard";

// Crisis (East) — the Cuban Brigade brinkmanship from Moscow's STAVKA. Gated by
// `conflictsEnabled`. Reached from the Command Console East column.
export default async function CrisisEastPage() {
  await requireConflictsEnabled();
  return <CrisisBoard side="east" />;
}

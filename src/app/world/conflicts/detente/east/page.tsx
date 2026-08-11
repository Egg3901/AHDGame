import { requireConflictsEnabled } from "../../_coldwar/gate";
import { DetenteBoard } from "../../_coldwar/DetenteBoard";

// Détente (East) — superpower-summit de-escalation from Moscow's chair. Gated by
// `conflictsEnabled`. Reached from the Command Console East column.
export default async function DetenteEastPage() {
  await requireConflictsEnabled();
  return <DetenteBoard side="east" />;
}

import { requireConflictsEnabled } from "../_coldwar/gate";
import { DetenteBoard } from "../_coldwar/DetenteBoard";

// Détente (West) — superpower-summit de-escalation from Washington's chair. Gated by
// `conflictsEnabled`. Reached from the Command Console West column.
export default async function DetenteWestPage() {
  await requireConflictsEnabled();
  return <DetenteBoard side="west" />;
}

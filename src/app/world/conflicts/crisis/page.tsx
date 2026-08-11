import { requireConflictsEnabled } from "../_coldwar/gate";
import { CrisisBoard } from "../_coldwar/CrisisBoard";

// Crisis (West) — the Cuban Brigade brinkmanship from Washington's chair. Gated by
// `conflictsEnabled`. Reached from the Command Console West column.
export default async function CrisisWestPage() {
  await requireConflictsEnabled();
  return <CrisisBoard side="west" />;
}

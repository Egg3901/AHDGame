import { requireConflictsEnabled } from "../_coldwar/gate";
import { IntelBoard } from "../_coldwar/IntelBoard";

// Intelligence (West) — "The Station", CIA clandestine ops. Gated by
// `conflictsEnabled`. Reached from the Command Console West column.
export default async function StationPage() {
  await requireConflictsEnabled();
  return <IntelBoard side="west" />;
}

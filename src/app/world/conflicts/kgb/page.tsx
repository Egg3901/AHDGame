import { requireConflictsEnabled } from "../_coldwar/gate";
import { IntelBoard } from "../_coldwar/IntelBoard";

// Intelligence (East) — "The Residency", KGB First Chief Directorate ops. Gated by
// `conflictsEnabled`. Reached from the Command Console East column.
export default async function KgbPage() {
  await requireConflictsEnabled();
  return <IntelBoard side="east" />;
}

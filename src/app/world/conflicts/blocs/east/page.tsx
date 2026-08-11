import { requireConflictsEnabled } from "../../_coldwar/gate";
import { BlocOverviewBoard } from "../../_coldwar/BlocOverviewBoard";

// Bloc Overview (East) — "The World Divided" from Moscow's STAVKA. Gated by
// `conflictsEnabled`. Reached from the Command Console East column.
export default async function ConflictsBlocsEastPage() {
  await requireConflictsEnabled();
  return <BlocOverviewBoard side="east" />;
}

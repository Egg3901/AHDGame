import { requireConflictsEnabled } from "../_coldwar/gate";
import { BlocOverviewBoard } from "../_coldwar/BlocOverviewBoard";

// Bloc Overview — "The World Divided". Gated by `conflictsEnabled`; themed-island
// shell and fonts come from the section layout.
export default async function ConflictsBlocsPage() {
  await requireConflictsEnabled();
  return <BlocOverviewBoard side="west" />;
}

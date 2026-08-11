import { requireConflictsEnabled } from "../_coldwar/gate";
import { HomeFrontBoard } from "../_coldwar/HomeFrontBoard";

// Home Front (West) — the domestic politics of US foreign policy. Gated by
// `conflictsEnabled`. Reached from the Command Console West column.
export default async function HomeFrontPage() {
  await requireConflictsEnabled();
  return <HomeFrontBoard side="west" />;
}

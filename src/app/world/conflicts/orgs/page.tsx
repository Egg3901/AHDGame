import { requireConflictsEnabled } from "../_coldwar/gate";
import { OrgsBoard } from "../_coldwar/OrgsBoard";

// International Organizations (West) — the diplomatic directory of NATO, the
// Warsaw Pact, the Non-Aligned Movement, the EEC, and the UN. Gated by
// `conflictsEnabled`. Reached from the Command Console West column.
export default async function OrgsPage() {
  await requireConflictsEnabled();
  return <OrgsBoard />;
}

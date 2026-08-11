import { requireConflictsEnabled } from "../_coldwar/gate";
import { WarsawPactBoard } from "../_coldwar/WarsawPactBoard";

// Warsaw Pact Command (East) — STAVKA's unified-command force-commitment console.
// Gated by `conflictsEnabled`. Reached from the Command Console East column.
export default async function WarsawPactPage() {
  await requireConflictsEnabled();
  return <WarsawPactBoard />;
}

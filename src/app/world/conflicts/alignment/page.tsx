import { redirect } from "next/navigation";
import { requireConflictsEnabled } from "../_coldwar/gate";

/**
 * Retired. The mock Alignment & Coercion board modelled 16 hardcoded nations in
 * localStorage on its own control-percentage scale; alignment now lives on real
 * data at the Cold War Ledger, which covers every nation in the world and reads
 * the `countryAlignments` collection.
 *
 * Its influence-lever interaction returns for real as influence plays on the
 * per-org Influence tab. Kept as a redirect rather than deleted so the Command
 * Console's navigation and any bookmark still land somewhere real.
 */
export default async function AlignmentPage() {
  await requireConflictsEnabled();
  redirect("/world/cold-war-ledger");
}

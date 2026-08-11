import { redirect } from "next/navigation";
import { requireConflictsEnabled } from "../_coldwar/gate";

/**
 * Retired alongside its Western twin — see `../alignment/page.tsx`. Both sides of
 * the mock board are superseded by the Cold War Ledger, which reads real
 * alignment for every nation rather than 16 hardcoded ones per side.
 */
export default async function ActiveMeasuresPage() {
  await requireConflictsEnabled();
  redirect("/world/cold-war-ledger");
}

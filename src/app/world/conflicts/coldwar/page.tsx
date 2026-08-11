import { requireConflictsEnabled } from "../_coldwar/gate";
import { redirect } from "next/navigation";

// The browser-local command mockup is retired. Keep the old URL as an alias for
// the live alignment ledger.
export default async function ConflictsColdWarPage() {
  await requireConflictsEnabled();
  redirect("/world/cold-war-ledger");
}

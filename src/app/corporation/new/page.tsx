import { redirect } from "next/navigation";

/** Preserve old creation links without treating "new" as a corporation ID. */
export default function NewCorporationPage() {
  redirect("/market");
}

import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/mongodb";
import { regionApprovalUrl } from "@/lib/urls";
import { resolveApprovalRoute } from "@/lib/states/approval/resolveApprovalRoute";

interface PageProps {
  params: Promise<{ id: string }>;
}

/** Legacy bare-ID route — redirect to the country-scoped approval page. */
export default async function LegacyApprovalRedirect({ params }: PageProps) {
  const { id } = await params;
  const db = await getDb();
  const resolved = await resolveApprovalRoute(db, id);

  if (!resolved) notFound();

  redirect(regionApprovalUrl(resolved.countryId, resolved.stateId));
}

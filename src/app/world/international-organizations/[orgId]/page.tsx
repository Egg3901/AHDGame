import { redirect } from "next/navigation";

/** Bare org route → its Overview sub-tab. */
export default async function OrgIndex({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  redirect(`/world/international-organizations/${orgId.toLowerCase()}/overview`);
}

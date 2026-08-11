"use client";

import { Skeleton } from "@/components/ui";
import { useOrg } from "../../OrgProvider";
import { useOrgInfluence } from "../../useOrgInfluence";
import { InfluenceTab } from "../../components/InfluenceTab";

export default function OrgInfluencePage() {
  const { org, viewer, refresh } = useOrg();
  const { view, loading, refresh: reloadInfluence } = useOrgInfluence(org.id);

  if (loading || !view) return <Skeleton className="h-64 w-full rounded-xl" />;

  return (
    <InfluenceTab
      view={view}
      orgId={org.id}
      viewerCountryId={viewer?.foreignMinisterOf ?? null}
      onChange={() => {
        // A play moves the fund balance the masthead shows too, so refresh both.
        reloadInfluence();
        refresh();
      }}
    />
  );
}

"use client";

import { useOrg } from "../../OrgProvider";
import { OverviewTab } from "../../components/OverviewTab";

export default function OrgOverviewPage() {
  const { org, viewer, currentTurn, votingWindowTurns, refresh } = useOrg();
  return (
    <OverviewTab
      org={org}
      viewer={viewer}
      currentTurn={currentTurn}
      votingWindowTurns={votingWindowTurns}
      onChange={refresh}
    />
  );
}

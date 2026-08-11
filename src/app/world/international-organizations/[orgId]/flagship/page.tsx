"use client";

import { useOrg } from "../../OrgProvider";
import { FlagshipTab } from "../../components/FlagshipTab";

export default function OrgFlagshipPage() {
  const { org, currentTurn } = useOrg();
  return <FlagshipTab org={org} currentTurn={currentTurn} />;
}

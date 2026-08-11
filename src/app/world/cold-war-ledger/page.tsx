import type { Metadata } from "next";
import { getDb } from "@/lib/mongodb";
import { publicPageMetadata } from "@/lib/siteMetadata";
import { loadWorldAlignment } from "@/lib/alignment/queries/worldAlignment";
import { ColdWarLedgerClient } from "./ColdWarLedgerClient";

export const metadata: Metadata = publicPageMetadata({
  title: "Cold War Ledger | A House Divided",
  description:
    "Where every nation stands between the blocs — each holds a share per bloc plus an uncommitted remainder, with the contested states the two sides are still fighting over.",
  pathname: "/world/cold-war-ledger",
});

export default async function ColdWarLedgerPage() {
  const db = await getDb();
  const view = await loadWorldAlignment(db);
  return <ColdWarLedgerClient view={view} />;
}

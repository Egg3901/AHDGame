import type { Metadata } from "next";
import { getDb } from "@/lib/mongodb";
import { publicPageMetadata } from "@/lib/siteMetadata";
import { loadWorldTradeLedger } from "@/lib/trade/queries/loadWorldTradeLedger";
import WorldTradeClient from "./WorldTradeClient";

export const metadata: Metadata = publicPageMetadata({
  title: "World Trade Ledger | A House Divided",
  description:
    "Balance of trade between nations — surplus and deficit by country, commodity, and pair across the shared simulation.",
  pathname: "/world/trade",
});

export default async function WorldTradePage() {
  const db = await getDb();
  const ledger = await loadWorldTradeLedger(db);
  return <WorldTradeClient ledger={ledger} />;
}

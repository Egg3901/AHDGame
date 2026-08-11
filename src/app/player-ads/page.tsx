import type { Metadata } from "next";
import { PlayerAdsClient } from "./PlayerAdsClient";
import { publicPageMetadata } from "@/lib/siteMetadata";

export const metadata: Metadata = publicPageMetadata({
  title: "Place a Banner Ad | A House Divided",
  description: "Promote your in-game faction, party, or corporation with a player-run banner ad.",
  pathname: "/player-ads",
});

export default function PlayerAdsPage() {
  return <PlayerAdsClient />;
}

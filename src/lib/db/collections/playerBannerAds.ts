import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { PlayerBannerAd } from "@/lib/db/types/playerBannerAd";

export async function getPlayerBannerAdsCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<PlayerBannerAd>("playerBannerAds");
}

import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { ProfileBorderKey } from "./patreon";

export interface ImperialCharacter {
  _id: ObjectId;
  userId: ObjectId;
  countryId: CountryId;
  name: string;
  gender: "male" | "female" | "nonbinary";
  homeState: string;
  sequentialId: number;

  // Royal Identity
  royalHouse: string;
  coatOfArmsUrl?: string;

  // Profile & Cosmetics
  avatarUrl?: string;
  profileHeaderImageUrl?: string;
  borderKey?: ProfileBorderKey;
  tintColor?: string;
  bio?: string;
  campaignSongUrl?: string;
  campaignSongAutoplay?: boolean;

  // Personal Wealth
  cashOnHand?: number;
  currencyBalances?: {
    personal: Partial<Record<CurrencyCode, number>>;
  };
  autoConvertEnabled?: boolean;
  displayCurrencyPreference?: "local" | "home" | "internal" | CurrencyCode;

  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

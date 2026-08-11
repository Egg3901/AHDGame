import type { CountryCreationInfo } from "@/lib/registration/types";

export type { CountryCreationInfo };

export type PartyOption = {
  id: string;
  name: string;
  abbreviation: string;
  color: string;
  memberCount: number;
  playerCount: number;
  isDefault: boolean;
  /**
   * Platform position on the shared −5..+5 ruler, as served by
   * `GET /api/country/[code]/parties`. Optional because older cached responses
   * and test fixtures may predate these fields.
   */
  economicPosition?: number;
  socialPosition?: number;
  /**
   * One-party-state standing, as served by `GET /api/country/[code]/parties`.
   * Null/absent in competitive systems, where it carries no meaning.
   */
  regimeStatus?: "ruling" | "approved" | "banned" | null;
};

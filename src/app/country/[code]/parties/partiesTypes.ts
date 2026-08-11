export interface PartyLeader {
  id: string;
  sequentialId?: number;
  name: string;
  avatarUrl?: string | null;
  borderKey?: string | null;
  tintColor?: string | null;
}

export interface Party {
  id: string;
  countryId: "US" | "UK" | "DE" | "JP" | "CN";
  name: string;
  abbreviation: string;
  color: string;
  discordInviteUrl?: string | null;
  economicPosition: number;
  socialPosition: number;
  chair: PartyLeader | null;
  viceChair: PartyLeader | null;
  treasurer: PartyLeader | null;
  treasury: number;
  memberCount: number;
  playerCount: number;
  nppCount: number;
  isDefault: boolean;
  /**
   * Major/Minor party tier (D5). Drives the tier badge + the national PS cap.
   * Resolved server-side (`resolvePartyTier`) so legacy rows fall back sensibly.
   */
  tier?: "major" | "minor";
  /**
   * Regime status for parties in countries with `governmentType: "onePartyState"`
   * (currently CN). `null` in non-one-party countries. See
   * `docs/design/ruling-party-confidence.md` for the three-tier model.
   */
  regimeStatus?: "ruling" | "approved" | "banned" | null;
  createdAt: string;
}

export interface UserData {
  username: string;
  isAdmin: boolean;
  hasCharacter: boolean;
  character?: {
    id: string;
    party: string;
    homeState: string;
    homeStateName?: string;
    countryId?: string;
    actions: number;
    funds: number;
  };
}

export interface SliceItem {
  id: string;
  name: string;
  abbreviation: string;
  color: string;
  value: number;
}

export interface OrgParty {
  id: string;
  name: string;
  abbreviation: string;
  color: string;
  totalOrg: number;
}

export interface PartyTrendPoint {
  partyId: string;
  turn: number;
  organization: number;
  playerCount: number;
  nppCount: number;
  memberCount: number;
  createdAt: string;
}

import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { OrganizationCategory } from "@/lib/constants/orgCategory";

/**
 * A player-created international organization. Stored alongside the built-in
 * orgs (EU/NATO/UN) but identified by a slug rather than a literal id. The
 * creator's country is the sole founding member; others join via the normal
 * membership-proposal flow.
 */
export interface CustomInternationalOrganization {
  _id: ObjectId;
  /** URL-safe slug used everywhere as `organizationId`. Unique. */
  id: string;
  name: string;
  shortName: string;
  description: string;
  charter: string;
  /** Optional uploaded emblem URL (R2 or local `/api/uploads/...`). */
  logoPath?: string | null;
  /** Shared classification (fixed at creation). Legacy docs may lack it. */
  category?: OrganizationCategory;
  /** Single-element list at creation: the creator's country. */
  foundingMembers: CountryId[];
  leadership: {
    title: string;
    termTurns: number;
  };
  creatorCharacterId: ObjectId;
  creatorCharacterName: string;
  creatorCountryId: CountryId;
  createdAt: Date;
  createdOnTurn: number;
}

import type { OrgMemberId } from "@/lib/db/types/internationalOrganization";
import {
  entityFlag as flagForEntity,
  entityName as nameForEntity,
} from "@/lib/constants/entityDisplay";

/**
 * Display name and flag for any organisation member.
 *
 * Thin re-export of the lib helper so client pages keep a stable import path.
 * Implementation lives in `entityDisplay` so the org summary service (which
 * cannot import from `app/`) uses the same resolution.
 */
export function entityName(id: OrgMemberId): string {
  return nameForEntity(id);
}

export function entityFlag(id: OrgMemberId): string {
  return flagForEntity(id);
}

import type { ObjectId } from "mongodb";
import type { InternationalOrganizationId } from "@/lib/constants/internationalOrganizations";
import type { AlertPosture } from "@/lib/constants/orgPosture";

/**
 * A security organization's current alliance alert posture (SSOT). One document
 * per organization, updated when a `set_posture` resolution passes. Absent ⇒ the
 * org sits at the default (`standard`) posture and applies no member-wide effect.
 */
export interface OrganizationPosture {
  _id: ObjectId;
  organizationId: InternationalOrganizationId;
  posture: AlertPosture;
  updatedAt: Date;
}

import type { Db } from "mongodb";
import { ensureIndex } from "./helpers";

// Indexes for the international-organizations subsystem (memberships,
// proposals, FTA legislation, leadership elections).
export async function seedInternationalOrganizationIndexes(db: Db, log: (msg: string) => void) {
  log("International organization indexes:");

  await ensureIndex(
    db,
    "organizationMemberships",
    { organizationId: 1, countryId: 1 },
    { unique: true, name: "organizationMemberships_org_country" },
    log
  );
  await ensureIndex(
    db,
    "organizationMemberships",
    { countryId: 1 },
    { name: "organizationMemberships_countryId" },
    log
  );

  await ensureIndex(
    db,
    "organizationWithdrawals",
    { organizationId: 1, countryId: 1 },
    { unique: true, name: "organizationWithdrawals_org_country" },
    log
  );

  await ensureIndex(
    db,
    "organizationMembershipProposals",
    { status: 1, closesOnTurn: 1 },
    { name: "organizationMembershipProposals_status_closes" },
    log
  );
  await ensureIndex(
    db,
    "organizationMembershipProposals",
    { organizationId: 1, status: 1 },
    { name: "organizationMembershipProposals_org_status" },
    log
  );

  await ensureIndex(
    db,
    "organizationLegislation",
    { organizationId: 1, status: 1 },
    { name: "organizationLegislation_org_status" },
    log
  );
  await ensureIndex(
    db,
    "organizationLegislation",
    { status: 1, closesOnTurn: 1 },
    { name: "organizationLegislation_status_closes" },
    log
  );
  await ensureIndex(
    db,
    "organizationLegislation",
    { type: 1, status: 1, parties: 1 },
    { name: "organizationLegislation_type_status_parties" },
    log
  );

  await ensureIndex(
    db,
    "organizationLeadership",
    { organizationId: 1 },
    { unique: true, name: "organizationLeadership_org" },
    log
  );

  await ensureIndex(
    db,
    "organizationLeadershipElections",
    { organizationId: 1, status: 1 },
    { name: "organizationLeadershipElections_org_status" },
    log
  );
  await ensureIndex(
    db,
    "organizationLeadershipElections",
    { status: 1, closesOnTurn: 1 },
    { name: "organizationLeadershipElections_status_closes" },
    log
  );

  await ensureIndex(
    db,
    "customInternationalOrganizations",
    { id: 1 },
    { unique: true, name: "customInternationalOrganizations_id" },
    log
  );
  await ensureIndex(
    db,
    "customInternationalOrganizations",
    { creatorCountryId: 1 },
    { name: "customInternationalOrganizations_creatorCountry" },
    log
  );

  log("International organization indexes ensured");
}

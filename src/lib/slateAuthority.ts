import type { Db, ObjectId } from "mongodb";
import type { PoliticalParty, StatePartyOrg } from "@/lib/db/types";
import { getStatePartyOrgDocumentId } from "@/lib/db/partyLookup";

export type SlateAssignerRole =
  "national_chair" | "national_vice_chair" | "state_chair" | "state_vice_chair";

export const STATE_SLATE_ASSIGNMENT_BONUS = 5;

export interface SlateAuthorityResult {
  canManage: boolean;
  assignerRole: SlateAssignerRole | null;
  assignerRoleLabel: string | null;
  getsStateAcceptanceBuff: boolean;
}

const ASSIGNER_ROLE_LABELS: Record<SlateAssignerRole, string> = {
  national_chair: "National Party Chair",
  national_vice_chair: "National Party Vice Chair",
  state_chair: "State / Regional Party Chair",
  state_vice_chair: "State / Regional Party Vice Chair",
};

export function getSlateAssignerRoleLabel(
  role: SlateAssignerRole | null | undefined
): string | null {
  if (!role) return null;
  return ASSIGNER_ROLE_LABELS[role];
}

export async function resolveSlateAuthority(args: {
  db: Db;
  party: PoliticalParty;
  stateId: string;
  actorId: ObjectId;
  isAdmin: boolean;
}): Promise<SlateAuthorityResult> {
  if (args.isAdmin) {
    return {
      canManage: true,
      assignerRole: null,
      assignerRoleLabel: null,
      getsStateAcceptanceBuff: false,
    };
  }

  const actorId = args.actorId.toString();
  if (args.party.chairId?.toString() === actorId) {
    return buildAuthority("national_chair");
  }
  if (args.party.viceChairId?.toString() === actorId) {
    return buildAuthority("national_vice_chair");
  }

  const stateParty = await args.db
    .collection<StatePartyOrg>("statePartyOrg")
    .findOne({ _id: getStatePartyOrgDocumentId(args.stateId, args.party) });
  if (stateParty?.chairId?.toString() === actorId) {
    return buildAuthority("state_chair");
  }
  if (stateParty?.viceChairId?.toString() === actorId) {
    return buildAuthority("state_vice_chair");
  }

  return {
    canManage: false,
    assignerRole: null,
    assignerRoleLabel: null,
    getsStateAcceptanceBuff: false,
  };
}

export function getSlateAcceptanceStatBonus(role: SlateAssignerRole | null | undefined): {
  loyaltyRequirementReduction: number;
  stubbornnessAllowanceBonus: number;
} {
  if (role === "state_chair" || role === "state_vice_chair") {
    return {
      loyaltyRequirementReduction: STATE_SLATE_ASSIGNMENT_BONUS,
      stubbornnessAllowanceBonus: STATE_SLATE_ASSIGNMENT_BONUS,
    };
  }

  return { loyaltyRequirementReduction: 0, stubbornnessAllowanceBonus: 0 };
}

function buildAuthority(role: SlateAssignerRole): SlateAuthorityResult {
  return {
    canManage: true,
    assignerRole: role,
    assignerRoleLabel: getSlateAssignerRoleLabel(role),
    getsStateAcceptanceBuff: role === "state_chair" || role === "state_vice_chair",
  };
}

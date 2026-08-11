/**
 * Domain logic for changing a UK First Minister's Devolution Policy.
 *
 * Mirrors the issueOrder/deliverAddress contract: validates inputs + AP,
 * applies the change, decrements AP, returns a thin status/body for the API.
 *
 * See docs/design/uk-devolution-policy.md.
 */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { DevolutionPolicy, GovernorOfficeState } from "@/lib/db/types/governorOfficeState";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import {
  DEVOLUTION_POLICY_CHANGE_AP_COST,
  DEVOLUTION_POLICY_CHANGE_COOLDOWN_TURNS,
  isUKDevolutionRegion,
} from "@/lib/constants/devolution";

export interface ChangeDevolutionPolicyInput {
  countryId: CountryId;
  stateId: string;
  policy: DevolutionPolicy;
  /** Admin override — bypasses AP + cooldown. Routes must verify the caller. */
  adminOverride?: boolean;
}

export interface ChangeDevolutionPolicyResult {
  status: number;
  body: {
    error?: string;
    policy?: DevolutionPolicy;
    changedAtTurn?: number;
    cooldownReadyAtTurn?: number;
  };
}

export async function changeDevolutionPolicy(
  db: Db,
  input: ChangeDevolutionPolicyInput
): Promise<ChangeDevolutionPolicyResult> {
  const { countryId, stateId, policy } = input;
  const adminOverride = input.adminOverride === true;

  if (countryId !== "UK") {
    return { status: 400, body: { error: "Devolution Policy is UK-only." } };
  }
  if (!isUKDevolutionRegion(stateId)) {
    return {
      status: 400,
      body: { error: "Region has no Devolution Policy axis." },
    };
  }
  if (policy !== "anti" && policy !== "pro" && policy !== "independence") {
    return { status: 400, body: { error: "Invalid policy." } };
  }

  const now = new Date();
  const currentTurn = await getCurrentTurn(db);

  const officeState = await db
    .collection<GovernorOfficeState>("governorOfficeState")
    .findOne({ countryId, stateId });
  if (!officeState) {
    return {
      status: 400,
      body: { error: "Office state row missing — cannot change policy." },
    };
  }

  // No-op guard — selecting the current policy returns a friendly error so
  // the modal doesn't burn 2 AP on an unintentional click.
  if (officeState.devolutionPolicy === policy) {
    return { status: 400, body: { error: "Policy is already set to this value." } };
  }

  if (!adminOverride) {
    if (officeState.gubernatorialActions < DEVOLUTION_POLICY_CHANGE_AP_COST) {
      return { status: 400, body: { error: "Insufficient office action points." } };
    }
    const lastChange = officeState.devolutionPolicyChangedAtTurn;
    if (lastChange != null) {
      const readyAt = lastChange + DEVOLUTION_POLICY_CHANGE_COOLDOWN_TURNS;
      if (currentTurn < readyAt) {
        return {
          status: 400,
          body: {
            error: `Policy change on cooldown until turn ${readyAt}.`,
            cooldownReadyAtTurn: readyAt,
          },
        };
      }
    }
  }

  const update: Record<string, unknown> = {
    devolutionPolicy: policy,
    devolutionPolicyChangedAtTurn: currentTurn,
    updatedAt: now,
  };
  const inc = adminOverride ? {} : { gubernatorialActions: -DEVOLUTION_POLICY_CHANGE_AP_COST };

  await db.collection<GovernorOfficeState>("governorOfficeState").updateOne(
    { countryId, stateId },
    {
      $set: update,
      ...(Object.keys(inc).length > 0 ? { $inc: inc } : {}),
    }
  );

  return {
    status: 200,
    body: {
      policy,
      changedAtTurn: currentTurn,
      cooldownReadyAtTurn: currentTurn + DEVOLUTION_POLICY_CHANGE_COOLDOWN_TURNS,
    },
  };
}

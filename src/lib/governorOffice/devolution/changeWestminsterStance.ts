/**
 * Westminster chooses a separate constitutional stance for each devolved region.
 * changeWestminsterStance spends national office AP and enforces a regional cooldown atomically.
 */
import { loadWestminsterGovernment } from "./westminsterGovernment";
import type { Db, Filter } from "mongodb";
import type { State } from "@/lib/db/types";
import type { DevolutionPolicy, GovernorOfficeState } from "@/lib/db/types/governorOfficeState";
import { getNationalStateId } from "@/lib/policy/nationalStateId";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import {
  DEVOLUTION_POLICY_CHANGE_AP_COST,
  resolveWestminsterPolicy,
  westminsterStanceChangeError,
} from "./rules";

export async function changeWestminsterStance(
  db: Db,
  input: {
    stateId: "SCO" | "WAL" | "NIR";
    policy: DevolutionPolicy;
  }
) {
  const collection = db.collection<GovernorOfficeState>("governorOfficeState");
  const key = { countryId: "UK" as const, stateId: getNationalStateId("UK") };
  const [office, currentTurn, government, region] = await Promise.all([
    collection.findOne(key),
    getCurrentTurn(db),
    loadWestminsterGovernment(db),
    db
      .collection<State>("states")
      .findOne({ _id: input.stateId, countryId: "UK" }, { projection: { _id: 1 } }),
  ]);
  if (!region)
    return { status: 404, body: { error: "Region is no longer part of the United Kingdom." } };
  if (!office) return { status: 409, body: { error: "National office state is missing." } };
  const stance = office.westminsterStances?.[input.stateId];
  const error = westminsterStanceChangeError({
    currentPolicy: resolveWestminsterPolicy(stance?.policy),
    policy: input.policy,
    changedAtTurn: stance?.changedAtTurn,
    currentTurn,
    actions: office.gubernatorialActions,
    changedUnderGovernment: stance?.changedUnderGovernment,
    government,
  });
  if (error) return { status: 400, body: { error } };
  const path = `westminsterStances.${input.stateId}`;
  // Compare the state we validated, and check the shared AP pool in the same write.
  // Two submissions cannot spend one balance or bypass the regional cooldown.
  const filter: Filter<GovernorOfficeState> = {
    ...key,
    gubernatorialActions: { $gte: DEVOLUTION_POLICY_CHANGE_AP_COST },
    [`${path}.policy`]: stance?.policy ?? { $exists: false },
    [`${path}.changedAtTurn`]: stance?.changedAtTurn ?? { $exists: false },
    [`${path}.changedUnderGovernment`]: stance?.changedUnderGovernment ?? { $exists: false },
  };
  const result = await collection.updateOne(filter, {
    $set: {
      [path]: {
        policy: input.policy,
        changedAtTurn: currentTurn,
        ...(government ? { changedUnderGovernment: government.key } : {}),
      },
      updatedAt: new Date(),
    },
    $inc: { gubernatorialActions: -DEVOLUTION_POLICY_CHANGE_AP_COST },
  });
  if (result.modifiedCount !== 1)
    return {
      status: 409,
      body: { error: "Office policy or action points changed. Refresh and try again." },
    };
  return { status: 200, body: { policy: input.policy, changedAtTurn: currentTurn } };
}

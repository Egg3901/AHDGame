import { regions } from "./regions";
import { parties } from "./parties";

export const statePartyOrg: any[] = [];

// Generate initial party org for each state-party combination
for (const region of regions) {
  for (const party of parties) {
    const baseOrg = party._id === "spd" || party._id === "cdu" ? 60 : 40;

    statePartyOrg.push({
      _id: `${region._id}_${party._id}`,
      state: region._id,
      party: party._id,
      organization: baseOrg,
      memberCount: 0,
    });
  }
}

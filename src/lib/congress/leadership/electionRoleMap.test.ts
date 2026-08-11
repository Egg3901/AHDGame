import { describe, expect, it } from "vitest";
import {
  HOUSE_ELECTION_ROLE_TO_LEADER,
  LEADERSHIP_ROLE_LABEL,
  SENATE_ELECTION_ROLE_TO_LEADER,
  houseElectionRoleToLeader,
  leadershipRoleLabel,
  senateElectionRoleToLeader,
} from "./electionRoleMap";

describe("electionRoleMap", () => {
  it("maps every house election role to its LeadershipRole", () => {
    expect(HOUSE_ELECTION_ROLE_TO_LEADER).toEqual({
      majority_leader: "majority_leader_house",
      minority_leader: "minority_leader_house",
      majority_whip: "majority_whip_house",
      minority_whip: "minority_whip_house",
    });
  });

  it("maps every senate election role to its LeadershipRole", () => {
    expect(SENATE_ELECTION_ROLE_TO_LEADER).toEqual({
      pro_tempore: "president_pro_tempore",
      majority_leader: "majority_leader_senate",
      minority_leader: "minority_leader_senate",
      majority_whip: "majority_whip_senate",
      minority_whip: "minority_whip_senate",
    });
  });

  it("returns canonical role via helper functions", () => {
    expect(houseElectionRoleToLeader("majority_leader")).toBe("majority_leader_house");
    expect(senateElectionRoleToLeader("pro_tempore")).toBe("president_pro_tempore");
  });

  it("provides a human-readable label for every LeadershipRole", () => {
    expect(LEADERSHIP_ROLE_LABEL.speaker_of_the_house).toBe("Speaker of the House");
    expect(LEADERSHIP_ROLE_LABEL.president_pro_tempore).toBe("President Pro Tempore");
    expect(LEADERSHIP_ROLE_LABEL.speaker_of_the_bundestag).toBe("Bundestagspräsident");
    expect(LEADERSHIP_ROLE_LABEL.majority_leader_house).toBe("House Majority Leader");
    expect(LEADERSHIP_ROLE_LABEL.minority_leader_house).toBe("House Minority Leader");
    expect(LEADERSHIP_ROLE_LABEL.majority_whip_house).toBe("House Majority Whip");
    expect(LEADERSHIP_ROLE_LABEL.minority_whip_house).toBe("House Minority Whip");
    expect(LEADERSHIP_ROLE_LABEL.majority_leader_senate).toBe("Senate Majority Leader");
    expect(LEADERSHIP_ROLE_LABEL.minority_leader_senate).toBe("Senate Minority Leader");
    expect(LEADERSHIP_ROLE_LABEL.majority_whip_senate).toBe("Senate Majority Whip");
    expect(LEADERSHIP_ROLE_LABEL.minority_whip_senate).toBe("Senate Minority Whip");
  });

  it("leadershipRoleLabel helper returns the same as the map", () => {
    expect(leadershipRoleLabel("president_pro_tempore")).toBe("President Pro Tempore");
    expect(leadershipRoleLabel("speaker_of_the_bundestag")).toBe("Bundestagspräsident");
  });
});

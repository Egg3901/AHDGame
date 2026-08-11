import { describe, it, expect } from "vitest";
import { buildDecisionHistory } from "./decisionHistory";
import type { CrisisDecisionNode } from "@/lib/db/types/crisis";

const TREE: CrisisDecisionNode[] = [
  {
    nodeId: "response",
    type: "choice",
    title: "Earthquake Response",
    description: "",
    requiredRoles: ["headOfState"],
    timeLimitMinutes: null,
    options: [
      {
        optionId: "response_civilian",
        label: "Civilian-Led Response",
        description: "",
        nextNodeId: "aid",
        effects: [],
      },
    ],
  },
  {
    nodeId: "aid",
    type: "choice",
    title: "International Aid",
    description: "",
    requiredRoles: ["any"],
    timeLimitMinutes: null,
    options: [
      {
        optionId: "aid_contribute",
        label: "Send Aid",
        description: "",
        nextNodeId: "terminal",
        effects: [],
      },
    ],
  },
  {
    nodeId: "terminal",
    type: "terminal",
    title: "Recovery Underway",
    description: "",
    requiredRoles: ["any"],
    timeLimitMinutes: null,
  },
];

describe("buildDecisionHistory", () => {
  it("maps each chosen option to '<node title>: <option label>'", () => {
    expect(buildDecisionHistory(TREE, ["response_civilian", "aid_contribute", "terminal"])).toEqual(
      ["Earthquake Response: Civilian-Led Response", "International Aid: Send Aid"]
    );
  });

  it("skips terminal node IDs in the path", () => {
    expect(buildDecisionHistory(TREE, ["terminal"])).toEqual([]);
  });

  it("falls back to the raw step when no owning option is found", () => {
    expect(buildDecisionHistory(TREE, ["unknown_step"])).toEqual(["unknown_step"]);
  });
});

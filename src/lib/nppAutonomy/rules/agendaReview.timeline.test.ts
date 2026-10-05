import { describe, expect, it } from "vitest";
import {
  runCandidateAgendaPolicy,
  runCurrentAgendaPolicy,
} from "../../../../scripts/sim/2320-agenda-cadence";

describe("#2320 controlled multi-term cadence comparison", () => {
  it("responds to worsening/removal and condition changes while retaining annual review", () => {
    expect(runCurrentAgendaPolicy()).toEqual([0, 24, 192]);
    expect(runCandidateAgendaPolicy()).toEqual([0, 24, 48, 78, 96, 102, 126, 144, 192, 240]);
  });
});

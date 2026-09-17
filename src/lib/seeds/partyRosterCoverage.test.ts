import { describe, expect, it } from "vitest";
import type { PartySeed } from "@/lib/seeds/reference/politicalParties";
import { selectPartyRosterForPreset } from "./ensureDefaultParties";
import { frParties } from "./fr/frParties";
import { itParties } from "./it/itParties";
import { esParties } from "./es/esParties";
import { seParties } from "./se/seParties";
import { trParties } from "./tr/trParties";
import { grParties } from "./gr/grParties";
import { atParties } from "./at/atParties";
import { fiParties } from "./fi/fiParties";
import { ngParties } from "./ng/ngParties";
import { brParties } from "./br/brParties";

const PRESETS = [
  "1953-default",
  "1979-default",
  "1991-default",
  "1999-default",
  "2007-default",
  "2019-default",
  "2023-default",
];

const ROSTERS: Array<[string, PartySeed[]]> = [
  ["FR", frParties],
  ["IT", itParties],
  ["ES", esParties],
  ["SE", seParties],
  ["TR", trParties],
  ["GR", grParties],
  ["AT", atParties],
  ["FI", fiParties],
  ["NG", ngParties],
  ["BR", brParties],
];

describe("party roster seed coverage", () => {
  it("never boots a supported country/preset with zero parties", () => {
    for (const preset of PRESETS) {
      for (const [countryId, seeds] of ROSTERS) {
        expect(
          selectPartyRosterForPreset(seeds, preset).length,
          `${preset} has no ${countryId} party roster`
        ).toBeGreaterThan(0);
      }
    }
  });

  it("prefers an explicitly authored roster over an inherited one", () => {
    expect(selectPartyRosterForPreset(ngParties, "2019-default")).toEqual(
      ngParties.filter((party) => party.validForPresets?.includes("2019-default"))
    );
  });
});

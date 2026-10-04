/** @vitest-environment happy-dom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { State } from "@/lib/db/types";
import type { NPPDisplaySimple } from "../StatePageTabsTypes";
import { NPPsList } from "./NPPsList";

describe("NPPsList", () => {
  it("labels each politician with the office they hold", () => {
    const npps = [
      {
        _id: "n1",
        name: "Bob Casey Jr.",
        party: "1",
        homeState: "PA",
        politicalInfluence: 10,
        currentOffice: { type: "senate", state: "PA" },
      },
      {
        _id: "n2",
        name: "Charles Jefferson",
        party: "1",
        homeState: "PA",
        politicalInfluence: 10,
        currentOffice: null,
      },
    ] as unknown as NPPDisplaySimple[];

    render(
      <NPPsList
        state={{ _id: "PA", name: "Pennsylvania", countryId: "US" } as State}
        npps={npps}
        partyOrg={[]}
      />
    );

    expect(screen.getByText("Senator")).toBeTruthy();
    expect(screen.getByText("Private Citizen")).toBeTruthy();
  });
});

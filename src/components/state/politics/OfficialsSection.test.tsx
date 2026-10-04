/** @vitest-environment happy-dom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { State } from "@/lib/db/types";
import type { SerializedOfficial } from "../StatePageTabsTypes";
import { SenateSection } from "./OfficialsSection";

describe("SenateSection", () => {
  it("explains an unelected national council instead of asking admins to seed two senators", () => {
    render(
      <SenateSection
        state={{ countryId: "DD" } as State}
        senators={[]}
        label="Staatsrat"
        isElected={false}
        configuredSeats={25}
        description="The collective head of state acting between Volkskammer sessions."
      />
    );

    expect(screen.getByText("25 members · unelected")).toBeTruthy();
    expect(
      screen.getByText("The collective head of state acting between Volkskammer sessions.")
    ).toBeTruthy();
    expect(screen.queryByText("2 seats")).toBeNull();
    expect(screen.queryByText(/Admin needs to initialize/)).toBeNull();
  });

  it("counts the region's own seats, not the national chamber size", () => {
    const senators = [
      { _id: "s1", characterName: "Bob Casey Jr.", nppId: "n1", isNPP: true, senateClass: 1 },
      { _id: "s2", characterName: "Pat Toomey", nppId: "n2", isNPP: true, senateClass: 3 },
    ] as unknown as SerializedOfficial[];
    render(
      <SenateSection
        state={{ countryId: "US", houseDistricts: 17 } as State}
        senators={senators}
        configuredSeats={100}
      />
    );

    expect(screen.getByText("2 seats")).toBeTruthy();
    expect(screen.queryByText("100 seats")).toBeNull();
    expect(screen.getByText("Senator, Class 1")).toBeTruthy();
  });
});

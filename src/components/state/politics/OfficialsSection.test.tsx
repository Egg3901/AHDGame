/** @vitest-environment happy-dom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { State } from "@/lib/db/types";
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
});

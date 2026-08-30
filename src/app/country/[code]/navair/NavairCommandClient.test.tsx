// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NavairCommandClient } from "./NavairCommandClient";

const fetchMock = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ ok: true }),
});

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

describe("NavairCommandClient", () => {
  it("collects a target before sending a strike order", async () => {
    render(
      <NavairCommandClient
        countryCode="DD"
        positionId="defence"
        formations={[
          {
            id: "wing-1",
            name: "1st Bomber Squadron",
            type: "Bomber Squadron",
            domain: "air",
            station: "eeu",
            stationName: "Eastern Europe",
            mission: "CAS",
            missionTarget: null,
            integrity: 100,
            readiness: 100,
            supply: 100,
            auto: false,
            warnings: [],
          },
        ]}
        navalMissions={[]}
        airMissions={[
          { key: "CAS", label: "Close Air Support", desc: "Support the front." },
          { key: "STRIKE_AIRBASE", label: "Airfield Strike", desc: "Hit enemy airfields." },
        ]}
        stations={[
          { id: "eeu", name: "Eastern Europe", allowed: true },
          { id: "weu", name: "Western Europe", allowed: true },
        ]}
        summary={{ holding: [], frontsWithoutAir: [], starving: 0, atWar: true }}
      />
    );

    fireEvent.change(screen.getByLabelText("Orders"), {
      target: { value: "STRIKE_AIRBASE" },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Target")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Target"), { target: { value: "eeu" } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      unitId: "wing-1",
      mission: "STRIKE_AIRBASE",
      missionTarget: "eeu",
    });
  });
});

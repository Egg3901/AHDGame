// @vitest-environment happy-dom
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en/elections.json";
import { ElectionHeader } from "./ElectionHeader";
import type { ElectionDetail } from "./ElectionDetailTypes";

afterEach(cleanup);
const election: ElectionDetail = {
  id: "vacancy",
  seatId: "HU_BUD:1",
  electionType: "nationalAssembly",
  state: "HU_BUD",
  countryId: "HU",
  cycle: 6,
  electionYear: 2013,
  hungarianModernByElection: { districtId: "HU_BUD:1" },
  senateClass: null,
  chamberClass: null,
  status: "active",
  totalSeats: 1,
  startTime: null,
  endTime: null,
  primaryEndTime: null,
  startTurn: 1123,
  endTurn: 1127,
  primaryEndTurn: 1125,
  durationHours: 4,
  primaryDurationHours: 2,
  inPrimary: true,
  isEnded: false,
  isUpcoming: false,
  inGeneral: false,
  byParty: [],
  allCandidates: [],
  snapshotHistory: [],
  generalVotes: null,
  myCharId: "player",
  myEndorsedCandidateId: null,
  gameState: null,
};

describe("Hungarian modern constituency race header", () => {
  it("identifies the frozen district and remaining term while preserving filing", () => {
    const onEnter = vi.fn();
    render(
      <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
        <ElectionHeader
          election={election}
          electionYear={2013}
          localInPrimary
          localIsEnded={false}
          localIsUpcoming={false}
          canEnter
          canWithdraw={false}
          actionLoading={false}
          onEnter={onEnter}
          onWithdraw={() => {}}
        />
      </NextIntlClientProvider>
    );
    expect(screen.getByRole("heading").textContent).toContain("2013");
    expect(
      screen.getByText(
        "Constituency by-election: HU_BUD:1. One seat for the remaining Assembly term."
      )
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Enter race" }));
    expect(onEnter).toHaveBeenCalledOnce();
  });
});

describe("presidential race header", () => {
  function renderHeader(electionType: ElectionDetail["electionType"]) {
    render(
      <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
        <ElectionHeader
          election={{ ...election, electionType, hungarianModernByElection: undefined }}
          electionYear={2013}
          localInPrimary
          localIsEnded={false}
          localIsUpcoming={false}
          canEnter={false}
          canWithdraw={false}
          actionLoading={false}
          onEnter={() => {}}
          onWithdraw={() => {}}
        />
      </NextIntlClientProvider>
    );
  }

  it("links presidential races to the powers explainer and the running guide", () => {
    renderHeader("president");
    expect(
      screen.getByRole("link", { name: "What the presidency can do" }).getAttribute("href")
    ).toBe("/wiki/reference-offices");
    expect(
      screen.getByRole("link", { name: "How to run for president" }).getAttribute("href")
    ).toBe("/guides/running-for-office");
  });

  it("does not show the presidency links on other races", () => {
    renderHeader("nationalAssembly");
    expect(screen.queryByRole("link", { name: "What the presidency can do" })).toBeNull();
  });
});

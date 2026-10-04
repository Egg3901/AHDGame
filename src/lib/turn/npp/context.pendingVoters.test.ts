import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { Bill, ElectedOfficial, State, StateBill } from "@/lib/db/types";
import { getCountryConfigForRuntime } from "@/lib/constants/countries";
import { resolveCountryOfficeLayout } from "@/lib/countries/rules/officeLayout";
import type { RuntimeCountryOffices } from "@/lib/countries/runtimeOffices";
import { collectPendingNppVoterIds } from "./context";

const now = new Date("2026-09-21T00:00:00.000Z");

function official(id: ObjectId, overrides: Partial<ElectedOfficial> = {}): ElectedOfficial {
  return {
    _id: new ObjectId(),
    characterId: null,
    countryId: "US",
    officeType: "house",
    isNPP: true,
    nppId: id,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function collect(opts: {
  officials: ElectedOfficial[];
  bills?: Bill[];
  stateBills?: StateBill[];
  states?: State[];
  preset?: string;
  runtimeCountryOffices?: Map<"RU", RuntimeCountryOffices>;
}): string[] {
  return collectPendingNppVoterIds({
    officials: opts.officials,
    bills: opts.bills ?? [],
    stateBills: opts.stateBills ?? [],
    states: opts.states ?? [],
    preset: opts.preset,
    runtimeCountryOffices: opts.runtimeCountryOffices,
    now,
    currentTurn: 73,
  }).map(String);
}

describe("collectPendingNppVoterIds", () => {
  it("omits officials who already voted and unrelated chambers", () => {
    const voted = new ObjectId();
    const pending = new ObjectId();
    const senator = new ObjectId();
    const bill = {
      _id: new ObjectId(),
      countryId: "US",
      status: "active",
      currentChamber: "house",
      votes: { [`npp_${voted}`]: "for" },
    } as Bill;

    expect(
      collect({
        officials: [
          official(voted),
          official(pending),
          official(senator, { officeType: "senate" }),
        ],
        bills: [bill],
      })
    ).toEqual([pending.toString()]);
  });

  it("checks each chamber vote map for concurrent bills", () => {
    const representative = new ObjectId();
    const senator = new ObjectId();
    const bill = {
      _id: new ObjectId(),
      countryId: "US",
      status: "active_both",
      votes: { [`npp_${representative}`]: "for" },
      otherChamberVotes: {},
      votingEndsOnTurn: 74,
      otherChamberVotingEndsOnTurn: 74,
    } as Bill;

    expect(
      collect({
        officials: [official(representative), official(senator, { officeType: "senate" })],
        bills: [bill],
      })
    ).toEqual([senator.toString()]);
  });

  it("includes only pending NPPs in the state's configured legislature", () => {
    const voted = new ObjectId();
    const pending = new ObjectId();
    const bill = {
      _id: new ObjectId(),
      stateId: "CA",
      status: "active",
      votes: { [`npp_${voted}`]: "against" },
    } as StateBill;
    const state = { _id: "CA", countryId: "US" } as State;

    expect(
      collect({
        officials: [
          official(voted, { officeType: "stateSenate", state: "CA" }),
          official(pending, { officeType: "stateSenate", state: "CA" }),
        ],
        stateBills: [bill],
        states: [state],
      })
    ).toEqual([pending.toString()]);
  });
});

describe("active Russian NPC policy hydration", () => {
  it.each([
    [{}, "unionCongress", "unionCongressDeputy"],
    [{ ruSovietSuccessionSinceTurn: 24 }, "congressOfPeoplesDeputies", "congressDeputy"],
    [{ ruFederalAssemblySinceTurn: 40 }, "stateDuma", "dumaDeputy"],
    [{ ruFederalAssemblySinceTurn: 40 }, "federationCouncil", "federationCouncilMember"],
  ])(
    "selects active deputies and excludes foreign and obsolete officials: %s",
    (markers, chamber, officeType) => {
      const active = new ObjectId();
      const foreign = new ObjectId();
      const obsolete = new ObjectId();
      const layout = resolveCountryOfficeLayout(
        getCountryConfigForRuntime("RU", "1991-default", markers)
      );
      const bill = {
        _id: new ObjectId(),
        countryId: "RU",
        status: "active",
        currentChamber: chamber,
        votes: {},
      } as Bill;
      expect(
        collect({
          officials: [
            official(active, { countryId: "RU", officeType }),
            official(foreign, { countryId: "US", officeType }),
            official(obsolete, { countryId: "RU", officeType: "supremeSovietDeputy" }),
          ],
          bills: [bill],
          preset: "1991-default",
          runtimeCountryOffices: new Map([["RU", layout]]),
        })
      ).toEqual([active.toString()]);
    }
  );

  it.each(["active_both", "veto_override"] as const)(
    "selects both Assembly chambers using their own vote maps for %s",
    (status) => {
      const lower = new ObjectId();
      const upper = new ObjectId();
      const layout = resolveCountryOfficeLayout(
        getCountryConfigForRuntime("RU", "1991-default", { ruFederalAssemblySinceTurn: 40 })
      );
      const bill = {
        _id: new ObjectId(),
        countryId: "RU",
        status,
        currentChamber: "stateDuma",
        votes: { [`npp_${lower}`]: "for" },
        otherChamberVotes: {},
        vetoOverrideVotes: { [`npp_${lower}`]: "for" },
        votingEndsOnTurn: 74,
        otherChamberVotingEndsOnTurn: 74,
      } as Bill;
      expect(
        collect({
          officials: [
            official(lower, { countryId: "RU", officeType: "dumaDeputy" }),
            official(upper, { countryId: "RU", officeType: "federationCouncilMember" }),
          ],
          bills: [bill],
          preset: "1991-default",
          runtimeCountryOffices: new Map([["RU", layout]]),
        })
      ).toEqual([upper.toString()]);
    }
  );

  it("loads no deputy policy positions while Congress is dissolved", () => {
    const layout = resolveCountryOfficeLayout(
      getCountryConfigForRuntime("RU", "1991-default", { ruCongressDissolvedSinceTurn: 40 })
    );
    expect(
      collect({
        officials: [official(new ObjectId(), { countryId: "RU", officeType: "congressDeputy" })],
        bills: [{ countryId: "RU", status: "veto_override" } as Bill],
        preset: "1991-default",
        runtimeCountryOffices: new Map([["RU", layout]]),
      })
    ).toEqual([]);
  });
});

it("hydrates legacy UK national bills without selecting US deputies", () => {
  const uk = new ObjectId();
  const us = new ObjectId();
  expect(
    collect({
      officials: [official(uk, { countryId: "UK", officeType: "commons" }), official(us)],
      bills: [
        {
          _id: new ObjectId(),
          stateId: "uk_national",
          currentChamber: "commons",
          status: "active",
          votes: {},
        } as Bill,
      ],
    })
  ).toEqual([uk.toString()]);
});

import { describe, expect, it } from "vitest";
import { planProvisionalRussianCongress } from "./provisionalCongress";

describe("territorial provisional Congress mandate", () => {
  it("keeps only retained deputies, preserving weights and vacancies without fabricating seats", () => {
    const plan = planProvisionalRussianCongress(
      [
        { stateId: "RU_WEST", seats: 8 },
        { stateId: "RU_EAST", seats: 3 },
      ],
      [
        {
          id: "slate",
          stateId: "RU_WEST",
          officeType: "unionCongressDeputy",
          party: "1",
          seatsHeld: 5,
          nppId: "npc",
        },
        {
          id: "player",
          stateId: "RU_EAST",
          officeType: "unionCongressDeputy",
          party: "2",
          characterId: "player",
        },
        { id: "departed", stateId: "SU_UA", officeType: "unionCongressDeputy", seatsHeld: 10 },
        { id: "executive", officeType: "chairmanOfCabinet" },
      ]
    );
    expect(plan.retained.map((row) => row.id)).toEqual(["slate", "player"]);
    expect(plan.retired.map((row) => row.id)).toEqual(["departed", "executive"]);
    expect(plan).toMatchObject({
      totalSeats: 11,
      occupiedSeats: 6,
      vacantSeats: 5,
      majorityThreshold: 6,
      seatsByParty: { "1": 5, "2": 1 },
    });
  });

  it("allows an entirely vacant but territorially valid provisional chamber", () => {
    expect(planProvisionalRussianCongress([{ stateId: "RU", seats: 10 }], [])).toMatchObject({
      totalSeats: 10,
      vacantSeats: 10,
      majorityThreshold: 6,
    });
  });

  it.each([0, -1, 1.5, NaN])("rejects invalid retained deputy weight %s", (seatsHeld) => {
    expect(() =>
      planProvisionalRussianCongress(
        [{ stateId: "RU", seats: 10 }],
        [{ id: "seat", stateId: "RU", officeType: "unionCongressDeputy", seatsHeld }]
      )
    ).toThrow("weight");
  });

  it("rejects overfilled regions even when the overall country has spare seats", () => {
    expect(() =>
      planProvisionalRussianCongress(
        [
          { stateId: "RU_WEST", seats: 2 },
          { stateId: "RU_EAST", seats: 100 },
        ],
        [
          {
            id: "seat",
            stateId: "RU_WEST",
            officeType: "unionCongressDeputy",
            nppId: "npc",
            seatsHeld: 3,
          },
        ]
      )
    ).toThrow("capacity");
  });

  it("rejects duplicate records and invalid or duplicate capacities", () => {
    expect(() => planProvisionalRussianCongress([{ stateId: "RU", seats: 0 }], [])).toThrow(
      "positive"
    );
    expect(() =>
      planProvisionalRussianCongress(
        [
          { stateId: "RU", seats: 1 },
          { stateId: "RU", seats: 1 },
        ],
        []
      )
    ).toThrow("distinct");
    expect(() =>
      planProvisionalRussianCongress(
        [{ stateId: "RU", seats: 2 }],
        [
          { id: "same", stateId: "RU", officeType: "unionCongressDeputy" },
          { id: "same", stateId: "RU", officeType: "unionCongressDeputy" },
        ]
      )
    ).toThrow("duplicate");
  });

  it("preserves a party identifier without mutating the result's prototype", () => {
    const plan = planProvisionalRussianCongress(
      [{ stateId: "RU", seats: 1 }],
      [
        {
          id: "seat",
          stateId: "RU",
          officeType: "unionCongressDeputy",
          nppId: "npc",
          party: "__proto__",
        },
      ]
    );
    expect(Object.getPrototypeOf(plan.seatsByParty)).toBe(Object.prototype);
    expect(Object.hasOwn(plan.seatsByParty, "__proto__")).toBe(true);
    expect(plan.seatsByParty["__proto__"]).toBe(1);
  });
  it("treats unheld office placeholders as vacancies", () => {
    const plan = planProvisionalRussianCongress(
      [{ stateId: "RU", seats: 1 }],
      [{ id: "placeholder", stateId: "RU", officeType: "unionCongressDeputy", party: "1" }]
    );
    expect(plan).toMatchObject({ occupiedSeats: 0, vacantSeats: 1, seatsByParty: {} });
    expect(plan.retained).toEqual([]);
  });

  it("keeps a player deputy limited to one seat", () => {
    expect(() =>
      planProvisionalRussianCongress(
        [{ stateId: "RU", seats: 2 }],
        [
          {
            id: "player",
            stateId: "RU",
            officeType: "unionCongressDeputy",
            characterId: "player",
            seatsHeld: 2,
          },
        ]
      )
    ).toThrow("one seat");
  });
  it("rejects two mandates for one player or ambiguous dual holders", () => {
    const seat = {
      id: "first",
      stateId: "RU",
      officeType: "unionCongressDeputy",
      characterId: "player",
    };
    for (const rows of [[seat, { ...seat, id: "second" }], [{ ...seat, nppId: "npc" }]]) {
      expect(() => planProvisionalRussianCongress([{ stateId: "RU", seats: 3 }], rows)).toThrow(
        "distinct deputy mandate"
      );
    }
  });
});

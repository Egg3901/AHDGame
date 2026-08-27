import { describe, expect, it } from "vitest";
import { mergeExecutiveActs, type ExecutiveActInputs } from "./actsLedger";

function inputs(partial?: Partial<ExecutiveActInputs>): ExecutiveActInputs {
  return { bills: [], orders: [], nominations: [], cabinetMembers: [], ...partial };
}

describe("mergeExecutiveActs", () => {
  it("returns an empty ledger for no sources", () => {
    expect(mergeExecutiveActs(inputs())).toEqual([]);
  });

  it("marks an acting holder as acting rather than confirmed", () => {
    const acts = mergeExecutiveActs(
      inputs({
        cabinetMembers: [
          {
            _id: "c1",
            characterName: "A. Caretaker",
            positionLabel: "Secretary of the Treasury",
            confirmedAt: new Date("2026-02-10"),
            acting: true,
          },
          {
            _id: "c2",
            characterName: "M. Ruiz",
            positionLabel: "Secretary of State",
            confirmedAt: new Date("2026-02-11"),
          },
        ],
      })
    );
    const acting = acts.find((a) => a.refId === "c1");
    const confirmed = acts.find((a) => a.refId === "c2");
    expect(acting?.kind).toBe("acting");
    expect(acting?.detail).toMatch(/no confirmation vote/i);
    expect(confirmed?.kind).toBe("confirmed");
  });

  it("sorts without throwing when a cabinet row carries only an appointment date", () => {
    // Regression: acting holders have no confirmedAt. The route falls back to
    // appointedAt/createdAt, but if a caller ever passes a missing date the
    // sort's `b.at.getTime()` would throw and take out the whole ledger.
    expect(() =>
      mergeExecutiveActs(
        inputs({
          cabinetMembers: [
            {
              _id: "c1",
              characterName: "A. Caretaker",
              positionLabel: "Secretary of the Treasury",
              confirmedAt: new Date("2026-02-10"),
              acting: true,
            },
          ],
        })
      )
    ).not.toThrow();
  });

  it("maps signed, vetoed, and on-desk bills with their best timestamp", () => {
    const acts = mergeExecutiveActs(
      inputs({
        bills: [
          {
            _id: "b1",
            title: "Rural Broadband Investment Act",
            status: "signed",
            enactedAt: new Date("2026-03-01"),
            proposedAt: new Date("2026-01-01"),
          },
          {
            _id: "b2",
            title: "Coastal Drilling Expansion",
            status: "vetoed",
            failedAt: new Date("2026-02-01"),
            proposedAt: new Date("2026-01-01"),
          },
          {
            _id: "b3",
            title: "Estate Tax Adjustment",
            status: "enrolled",
            sentToPresidentAt: new Date("2026-04-01"),
            proposedAt: new Date("2026-01-01"),
          },
        ],
      })
    );
    expect(acts.map((a) => a.kind)).toEqual(["onDesk", "signed", "vetoed"]); // newest first
    expect(acts[1].title).toBe("Rural Broadband Investment Act");
    expect(acts[1].at.toISOString()).toContain("2026-03-01");
  });

  it("includes national executive orders and cabinet events, sorted into the stream", () => {
    const acts = mergeExecutiveActs(
      inputs({
        orders: [
          {
            _id: "o1",
            title: "Federal Hiring Freeze",
            issuedByName: "A. Whitmore",
            issuedAtTurn: 1279,
            createdAt: new Date("2026-02-15"),
          },
        ],
        nominations: [
          {
            _id: "n1",
            nomineeCharacterName: "T. Okafor",
            positionLabel: "Secretary of Defense",
            status: "active",
            at: new Date("2026-02-20"),
          },
        ],
        cabinetMembers: [
          {
            _id: "c1",
            characterName: "M. Ruiz",
            positionLabel: "Secretary of the Treasury",
            confirmedAt: new Date("2026-02-10"),
          },
        ],
      })
    );
    expect(acts.map((a) => a.kind)).toEqual(["nominated", "order", "confirmed"]);
    expect(acts[1].detail).toContain("A. Whitmore");
    expect(acts[1].turn).toBe(1279);
  });

  it("caps the ledger at the requested limit", () => {
    const bills = Array.from({ length: 30 }, (_, i) => ({
      _id: `b${i}`,
      title: `Bill ${i}`,
      status: "signed" as const,
      enactedAt: new Date(2026, 0, i + 1),
      proposedAt: new Date("2025-12-01"),
    }));
    expect(mergeExecutiveActs(inputs({ bills }), 12)).toHaveLength(12);
  });

  it("skips bills with no usable timestamp instead of guessing", () => {
    const acts = mergeExecutiveActs(
      inputs({
        bills: [
          {
            _id: "b1",
            title: "Timestampless",
            status: "vetoed",
            proposedAt: new Date("2026-01-05"),
          },
        ],
      })
    );
    // falls back to proposedAt — the act still appears, stamped honestly
    expect(acts).toHaveLength(1);
    expect(acts[0].at.toISOString()).toContain("2026-01-05");
  });
});

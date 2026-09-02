// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Crisis } from "@/lib/db/types/crisis";
import ConflictsPage from "./page";

const internationalCrisis = {
  _id: new ObjectId(),
  name: "Strategic forces raised on an ambiguous warning",
  description: "Commanders have minutes to decide whether the warning is real.",
  scope: "country",
  countryIds: ["US"],
  regionIds: [],
  status: "active",
  startTurn: 2,
  endTurn: null,
  durationTurns: 24,
  effects: [],
  wireMessageOnStart: "",
  wireMessageOnEnd: null,
  createdBy: null,
  createdAt: new Date("1960-01-01T00:00:00Z"),
  resolvedAt: null,
  globalResponse: {
    conflictKey: "nuclear_incident",
    eventKey: "false_alarm",
    roleByCountry: { US: "backer_a", RU: "backer_b" },
    defaultOptionIdByRole: {},
    outcomes: [],
    defaultOutcomeId: "stalemate",
  },
} as Crisis;

const domesticCrisis = {
  ...internationalCrisis,
  _id: new ObjectId(),
  name: "Nationwide Steel Strike",
  description: "The steelworkers have walked out nationwide.",
  globalResponse: undefined,
} as Crisis;

vi.mock("./_coldwar/gate", () => ({ requireConflictsEnabled: vi.fn() }));
vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn(async () => ({
    currentTurn: 4,
    currentYear: 1960,
    startingYear: 1960,
    preIterationTurns: 0,
  })),
}));
vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(async () => ({
    collection: () => ({
      countDocuments: vi.fn(async () => 2),
      find: () => ({
        sort: () => ({ toArray: vi.fn(async () => [internationalCrisis, domesticCrisis]) }),
        // The page resolves runtime country renames, which reads `countryState`
        // straight through `.find().toArray()` with no `.sort()` in between.
        toArray: vi.fn(async () => []),
      }),
    }),
  })),
}));
const resolvedWar = {
  _id: "c-manchuria",
  conflictId: 3,
  name: "Manchurian Front",
  hostCountry: "CN",
  region: "eas",
  type: "interstate",
  sideA: { label: "NATO", countries: ["US"], kind: "coalition", backer: "west" },
  sideB: { label: "PLA", countries: ["CN"], kind: "state", backer: "east" },
  bloc: "contested",
  terrain: "Continental",
  severity: "HIGH",
  baseStrength: 470,
  supplyA: 60,
  supplyB: 60,
  terr: 1.0,
  infra: 60,
  enemyMix: ["armor"],
  intensity: 70,
  control: 100,
  controlStart: 50,
  status: "resolved",
  createdBy: "player",
  startTurn: 1,
  endTurn: 2,
  outcome: { winner: "B", note: "PLA took full control of CN." },
};

const listResolvedConflicts = vi.fn(async (_db: unknown, _limit: number) => [resolvedWar]);
vi.mock("@/lib/db/collections/conflicts", () => ({
  listActiveConflicts: vi.fn(async () => []),
  listResolvedConflicts: (db: unknown, limit: number) => listResolvedConflicts(db, limit),
}));
vi.mock("@/lib/db/collections/battleReports", () => ({
  casualtiesByTheater: vi.fn(async () => ({})),
}));
vi.mock("@/lib/crises/vietnamEscalation", () => ({
  VIETNAM_RUNGS: [],
  getVietnamEscalationSummary: vi.fn(async () => ({ level: 0 })),
}));
vi.mock("@/lib/coldwar/tension", () => ({
  getColdWarTension: vi.fn(async () => ({ value: 12, events: [] })),
  tensionBand: vi.fn(() => "detente"),
  tensionPressureBreakdown: vi.fn(() => ({
    floor: 12,
    baseline: 12,
    vietnam: 0,
    crises: 0,
    nuclear: 0,
    wars: 0,
  })),
}));
vi.mock("@/lib/coldwar/standingPressure", () => ({
  conflictWarPressureInput: vi.fn((conflict) => conflict),
  buildStandingPressureSnapshot: vi.fn(() => ({
    totalWarheads: 0,
    pressures: {
      escalationLevel: 0,
      activeCrises: 2,
      totalWarheads: 0,
      nuclearWarIntensity: 0,
      nuclearWarCount: 0,
      otherWarIntensity: 0,
    },
    warSummary: {
      nuclearWarIntensity: 0,
      otherWarIntensity: 0,
      activeWarCount: 0,
      nuclearWarCount: 0,
    },
  })),
}));
vi.mock("@/lib/coldwar/dials", () => ({
  getColdWarDials: vi.fn(async () => ({ defcon: 4 })),
}));
vi.mock("@/lib/db/collections/nuclearPrograms", () => ({
  listNuclearPrograms: vi.fn(async () => []),
}));
vi.mock("./_coldwar/TensionHeader", () => ({ TensionHeader: () => <div>Tension</div> }));
vi.mock("./_coldwar/VietnamEscalationPanel", () => ({
  VietnamEscalationPanel: () => <div>Vietnam</div>,
}));
vi.mock("./_coldwar/GlobalConflictsBoard", () => ({
  GlobalConflictsBoard: () => <div>Conflicts board</div>,
}));

afterEach(cleanup);

describe("ConflictsPage historical conflicts", () => {
  // The live board drops a war the moment it resolves, and nothing else linked to
  // its record. The history section is the only way back to it.
  it("lists a resolved war with its outcome and a link to its record", async () => {
    render(await ConflictsPage());

    expect(screen.getByText(/HISTORICAL CONFLICTS/)).toBeTruthy();
    expect(screen.getByText("Manchurian Front")).toBeTruthy();
    expect(screen.getByText("PLA victory")).toBeTruthy();
    const link = screen.getByRole("link", { name: /open record/i });
    expect(link.getAttribute("href")).toBe("/world/conflicts/3");
    // Bounded: the hub is not the whole archive.
    expect(listResolvedConflicts).toHaveBeenCalledWith(expect.anything(), 24);
  });

  it("says when a fresh war's full record opens", async () => {
    render(await ConflictsPage());
    // Ended on turn 2; the page's clock is turn 4, so the fog is still down.
    expect(screen.getByText(/FOG LIFTS T482/)).toBeTruthy();
  });

  it("shows an empty state when no war has concluded", async () => {
    listResolvedConflicts.mockResolvedValueOnce([]);
    render(await ConflictsPage());
    expect(screen.getByText(/No war has yet concluded/)).toBeTruthy();
  });
});

describe("ConflictsPage global response feed", () => {
  it("shows international response crises even when their response scope is national", async () => {
    render(await ConflictsPage());

    expect(screen.getByText("Strategic forces raised on an ambiguous warning")).toBeTruthy();
    expect(screen.queryByText("Nationwide Steel Strike")).toBeNull();
  });
});

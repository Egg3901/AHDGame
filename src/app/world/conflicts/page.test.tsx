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
      }),
    }),
  })),
}));
vi.mock("@/lib/db/collections/conflicts", () => ({
  listActiveConflicts: vi.fn(async () => []),
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

describe("ConflictsPage global response feed", () => {
  it("shows international response crises even when their response scope is national", async () => {
    render(await ConflictsPage());

    expect(screen.getByText("Strategic forces raised on an ambiguous warning")).toBeTruthy();
    expect(screen.queryByText("Nationwide Steel Strike")).toBeNull();
  });
});

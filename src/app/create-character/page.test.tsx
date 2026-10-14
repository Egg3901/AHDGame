// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IntakeStatus } from "@/lib/auth/intakeStatus";

const mocks = vi.hoisted(() => ({
  user: null as null | { userId: string; isAdmin?: boolean },
  intake: null as null | IntakeStatus,
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/lib/auth", () => ({ getAuthUser: async () => mocks.user }));
vi.mock("@/lib/mongodb", () => ({ getDb: async () => ({}) }));
vi.mock("@/lib/auth/intakeStatus", () => ({
  loadIntakeStatus: async () => {
    if (!mocks.intake) throw new Error("db down");
    return mocks.intake;
  },
}));
vi.mock("./CreateCharacterClient", () => ({ default: () => <div>creation form</div> }));
vi.mock("@/components/intake/IntakeBlockedBeacon", () => ({ IntakeBlockedBeacon: () => null }));

import CreateCharacterPage from "./page";

const open: IntakeStatus = {
  registration: { open: true, reason: null },
  characterCreation: { open: true, reason: null },
  maintenanceMode: "off",
  expectedEnd: null,
};
const partial: IntakeStatus = {
  registration: { open: false, reason: "maintenance" },
  characterCreation: { open: false, reason: "maintenance" },
  maintenanceMode: "partial",
  expectedEnd: null,
};

beforeEach(() => {
  mocks.user = { userId: "u1" };
  mocks.intake = open;
  mocks.redirect.mockClear();
});
afterEach(cleanup);

describe("/create-character server gate", () => {
  it("sends a visitor with no session to login", async () => {
    mocks.user = null;
    await expect(CreateCharacterPage()).rejects.toThrow(
      "REDIRECT:/login?returnUrl=%2Fcreate-character"
    );
  });

  it("renders the form when creation is open", async () => {
    render(await CreateCharacterPage());
    expect(screen.getByText("creation form")).toBeTruthy();
  });

  it("shows the closed panel instead of the form during maintenance", async () => {
    mocks.intake = partial;
    render(await CreateCharacterPage());
    expect(screen.getByText("Your account is ready")).toBeTruthy();
    expect(screen.queryByText("creation form")).toBeNull();
  });

  it("lets an admin through maintenance, matching the creation route", async () => {
    mocks.user = { userId: "a1", isAdmin: true };
    mocks.intake = partial;
    render(await CreateCharacterPage());
    expect(screen.getByText("creation form")).toBeTruthy();
  });

  it("fails open to the form when the gate cannot be read", async () => {
    mocks.intake = null;
    render(await CreateCharacterPage());
    expect(screen.getByText("creation form")).toBeTruthy();
  });
});

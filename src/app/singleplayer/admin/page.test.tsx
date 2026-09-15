// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SingleplayerStatus } from "@/lib/singleplayerServer";
import SingleplayerAdminPage from "./page";

const mocks = vi.hoisted(() => ({
  singleplayer: { value: true },
  status: vi.fn(),
  availability: vi.fn(),
  admin: vi.fn(),
}));

vi.mock("@/lib/singleplayer", () => ({
  isSingleplayer: () => mocks.singleplayer.value,
}));
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock("@/lib/singleplayerServer", () => ({ singleplayerStatus: mocks.status }));
vi.mock("@/lib/singleplayerOperator", () => ({
  getSingleplayerWorldAvailability: mocks.availability,
}));
vi.mock("@/lib/auth", () => ({ getAuthAdmin: mocks.admin }));

class RedirectError extends Error {
  url: string;
  constructor(url: string) {
    super(`redirect:${url}`);
    this.url = url;
  }
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  redirect: (url: string): never => {
    throw new RedirectError(url);
  },
  notFound: (): never => {
    throw new Error("not-found");
  },
}));

function careerStatus(overrides: Partial<SingleplayerStatus> = {}): SingleplayerStatus {
  return {
    singleplayer: true,
    accountCreated: true,
    hasWorld: true,
    turn: 3,
    preset: "1953-default",
    turnInProgress: false,
    hasCharacter: true,
    characterName: "Tester",
    mode: "career",
    setup: null,
    permanentHeadOfState: false,
    playerless: false,
    spectatorPath: "/singleplayer/worldsim",
    warmAssets: [],
    ...overrides,
  } as SingleplayerStatus;
}

async function redirectUrl(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
  } catch (error) {
    if (error instanceof RedirectError) return error.url;
    throw error;
  }
  return null;
}

beforeEach(() => {
  mocks.singleplayer.value = true;
  mocks.status.mockReset().mockResolvedValue(careerStatus());
  mocks.availability.mockReset().mockResolvedValue("off");
  mocks.admin.mockReset().mockResolvedValue({ isAdmin: true });
});

describe("SingleplayerAdminPage owner routing", () => {
  it("renders the panel for the world owner", async () => {
    render(await SingleplayerAdminPage());

    expect(screen.getByText("Your local world")).toBeTruthy();
    expect(screen.getByText("Open for play")).toBeTruthy();
  });

  it("renders the sealed state the launcher left behind", async () => {
    mocks.availability.mockResolvedValue("full");
    render(await SingleplayerAdminPage());

    expect(screen.getByText("Paused and sealed")).toBeTruthy();
  });

  it("returns a non-owner with a character to the game", async () => {
    mocks.admin.mockResolvedValue(null);

    await expect(redirectUrl(() => SingleplayerAdminPage())).resolves.toBe("/profile");
  });

  it("returns a non-owner without a character to creation", async () => {
    mocks.admin.mockResolvedValue(null);
    mocks.status.mockResolvedValue(careerStatus({ hasCharacter: false, characterName: null }));

    await expect(redirectUrl(() => SingleplayerAdminPage())).resolves.toBe("/create-character");
  });

  it("returns a worldsim non-owner to the spectator path", async () => {
    mocks.admin.mockResolvedValue(null);
    mocks.status.mockResolvedValue(careerStatus({ mode: "worldsim" }));

    await expect(redirectUrl(() => SingleplayerAdminPage())).resolves.toBe(
      "/singleplayer/worldsim"
    );
  });

  it("hides the panel outside singleplayer without touching the world", async () => {
    mocks.singleplayer.value = false;

    await expect(SingleplayerAdminPage()).rejects.toThrow("not-found");
    expect(mocks.status).not.toHaveBeenCalled();
  });
});

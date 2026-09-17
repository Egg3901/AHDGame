// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SingleplayerStatus } from "@/lib/singleplayerServer";
import {
  DEFAULT_SINGLEPLAYER_FEATURE_FLAGS,
  SINGLEPLAYER_FEATURE_FLAGS,
} from "@/lib/singleplayerFeatureFlags";
import { SingleplayerAdmin } from "./SingleplayerAdmin";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));

const status = {
  turn: 3,
  hasWorld: true,
  hasCharacter: true,
  characterName: "Tester",
  turnInProgress: false,
  mode: "career",
  setup: {
    mode: "career",
    difficulty: "normal",
    autonomyLevel: "v4",
    permanentHeadOfState: false,
    featureFlags: {
      ...DEFAULT_SINGLEPLAYER_FEATURE_FLAGS,
      forexEnabled: false,
      worldEventsEnabled: true,
    },
  },
} as unknown as SingleplayerStatus;

describe("SingleplayerAdmin running-world feature flags", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refresh.mockReset();
  });

  it("renders every supported gate with its current persisted value", () => {
    render(<SingleplayerAdmin status={status} initialAvailability="open" />);

    for (const flag of SINGLEPLAYER_FEATURE_FLAGS) {
      const input = screen.getByLabelText(flag.label) as HTMLInputElement;
      expect(input.checked).toBe(
        flag.key === "forexEnabled"
          ? false
          : flag.key === "worldEventsEnabled"
            ? true
            : DEFAULT_SINGLEPLAYER_FEATURE_FLAGS[flag.key]
      );
      expect(screen.getByText(flag.description)).toBeTruthy();
    }
  });

  it("saves toggled flags with the merged feature map", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    render(<SingleplayerAdmin status={status} initialAvailability="open" />);

    fireEvent.click(screen.getByLabelText("Foreign exchange"));
    fireEvent.click(screen.getByRole("button", { name: "Save world rules" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/singleplayer/operator/config");
    expect(JSON.parse(String(init.body))).toEqual({
      difficulty: "normal",
      autonomyLevel: "v4",
      featureFlags: {
        ...DEFAULT_SINGLEPLAYER_FEATURE_FLAGS,
        forexEnabled: true,
        worldEventsEnabled: true,
      },
    });
  });
});

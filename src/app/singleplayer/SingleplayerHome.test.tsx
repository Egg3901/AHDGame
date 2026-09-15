// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SINGLEPLAYER_FEATURE_FLAGS } from "@/lib/singleplayerFeatureFlags";
import { SingleplayerHome } from "./SingleplayerHome";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const emptyStatus = {
  hasWorld: false,
  hasCharacter: false,
  turnInProgress: false,
  playerless: true,
  warmAssets: [],
} as never;

describe("SingleplayerHome new-game rules", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    push.mockReset();
    refresh.mockReset();
  });

  it("shows shipped rule defaults and submits changed rules plus the complete feature map", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ logs: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    render(<SingleplayerHome status={emptyStatus} />);

    expect((screen.getByLabelText("Career") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Difficulty") as HTMLSelectElement).value).toBe("normal");
    expect((screen.getByLabelText("Autonomous politicians") as HTMLSelectElement).value).toBe("v4");

    fireEvent.click(screen.getByLabelText("Head of state"));
    fireEvent.change(screen.getByLabelText("Difficulty"), { target: { value: "hard" } });
    fireEvent.change(screen.getByLabelText("Autonomous politicians"), { target: { value: "v5" } });
    fireEvent.click(screen.getByText("Advanced feature flags"));
    const autoSector = screen.getByLabelText("Automatic sector seeding");
    expect((autoSector as HTMLInputElement).checked).toBe(false);
    fireEvent.click(autoSector);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      preset: "1953-default",
      mode: "head-of-state",
      difficulty: "hard",
      autonomyLevel: "v5",
      featureFlags: { ...DEFAULT_SINGLEPLAYER_FEATURE_FLAGS, autoSectorSeedEnabled: true },
    });
  });

  it("keeps an existing world until the second destructive click", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    render(<SingleplayerHome status={{ ...emptyStatus, hasWorld: true } as never} />);

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/This replaces your current world/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Yes, start over" }));
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render as renderUi, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import { StateOrganizationTab } from "./StateOrganizationTab";
import messages from "../../../../messages/en/elections.json";
const render = (ui: ReactElement) =>
  renderUi(ui, {
    wrapper: ({ children }) => (
      <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
        {children}
      </NextIntlClientProvider>
    ),
  });
const translate = (key: keyof typeof messages.elections.campaignPresence) =>
  messages.elections.campaignPresence[key];
const clock = vi.hoisted(() => ({ currentTurn: 12 }));
vi.mock("@/contexts/useGameClock", () => ({ useGameClock: () => clock }));
vi.mock("@/components/PrimaryElectoralMap", () => ({
  PrimaryElectoralMap: ({
    onStateClick,
    stateData,
  }: {
    onStateClick: (state: string) => void;
    stateData: Record<string, { tooltip: string[] }>;
  }) => (
    <button data-tooltip={stateData.IA?.tooltip.join("; ")} onClick={() => onStateClick("IA")}>
      Select Iowa
    </button>
  ),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clock.currentTurn = 12;
});
const data = {
  canBuild: true,
  states: [
    {
      stateId: "IA",
      level: 2,
      totalInvested: 10,
      nextCost: 100_000,
      updatedAt: "2026-01-01T12:00:00Z",
      builtThisTurn: true,
      spentThisTurn: 123_456,
    },
  ],
  racePresence: [
    { characterId: "self", name: "Candidate", isSelf: true, party: "1", levelsByState: { IA: 2 } },
    { characterId: "other", name: "Rival", isSelf: false, party: "2", levelsByState: { IA: 3 } },
  ],
};
it("keeps the build disabled when selecting your own candidate's presence", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => data }))
  );
  render(<StateOrganizationTab />);
  fireEvent.click(await screen.findByRole("button", { name: "Candidate (you)" }));
  fireEvent.click(screen.getByRole("button", { name: "Select Iowa" }));
  expect(screen.getByText("Built this turn. Available again next turn.")).toBeTruthy();
  expect(screen.getByText("Spent this turn")).toBeTruthy();
  expect(screen.getByText("$123,456")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Build \(\+1\)/ }).hasAttribute("disabled")).toBe(true);
});

it("shows public candidate levels to spectators without build controls or private investment", async () => {
  const fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      ...data,
      canBuild: false,
      states: data.states.map((row) => ({ ...row, level: 0, builtThisTurn: false })),
    }),
  }));
  vi.stubGlobal("fetch", fetch);
  render(<StateOrganizationTab showHubLink />);
  fireEvent.click(await screen.findByRole("button", { name: "Select Iowa" }));
  // Even a former US candidate now viewing as a spectator gets the public levels.
  expect(screen.getByText("2", { selector: "dd" })).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Select Iowa" }).getAttribute("data-tooltip")
  ).toContain("Level: 2;");
  fireEvent.click(screen.getByRole("button", { name: "Rival" }));
  expect(screen.getByText("3", { selector: "dd" })).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Select Iowa" }).getAttribute("data-tooltip")
  ).toContain("Level: 3;");
  expect(screen.queryByRole("button", { name: "You" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Build|Viewing/ })).toBeNull();
  expect(screen.queryByRole("link", { name: /Political Operations hub/ })).toBeNull();
  expect(screen.queryByText("Next level costs")).toBeNull();
  expect(screen.queryByText("Career investment")).toBeNull();
  expect(screen.queryByText("Spent this turn")).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("explains an empty race to spectators", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ canBuild: false, states: [], racePresence: [] }),
    }))
  );
  render(<StateOrganizationTab />);
  expect(await screen.findByText(translate("empty"))).toBeTruthy();
});

it("shows an access error rather than silently hiding the tab", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 403 }))
  );
  render(<StateOrganizationTab />);
  expect(await screen.findByText(translate("unavailable"))).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Build/ })).toBeNull();
});
it("refreshes the marker at the next turn boundary", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => data })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...data,
        states: data.states.map((row) => ({ ...row, builtThisTurn: false })),
      }),
    });
  vi.stubGlobal("fetch", fetch);
  const { rerender } = render(<StateOrganizationTab />);
  await screen.findByText("Built this turn: IA");
  clock.currentTurn = 13;
  rerender(<StateOrganizationTab />);
  await vi.waitFor(() => expect(screen.queryByText("Built this turn: IA")).toBeNull());
  expect(fetch).toHaveBeenCalledTimes(2);
});

it.each([401, 403, 500])(
  "clears stale data and building on a failed refresh (%s), then recovers",
  async (status) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => data })
      .mockResolvedValueOnce({ ok: false, status })
      .mockResolvedValueOnce({ ok: true, json: async () => data });
    vi.stubGlobal("fetch", fetch);
    const { rerender } = render(<StateOrganizationTab />);
    fireEvent.click(await screen.findByRole("button", { name: "Select Iowa" }));
    clock.currentTurn = 13;
    rerender(<StateOrganizationTab />);
    expect(
      await screen.findByText(translate(status === 500 ? "loadFailed" : "unavailable"))
    ).toBeTruthy();
    expect(screen.queryByText("$123,456")).toBeNull();
    expect(screen.queryByRole("button", { name: /Build \(\+1\)/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rival" })).toBeNull();
    clock.currentTurn = 14;
    rerender(<StateOrganizationTab />);
    expect(await screen.findByText("$123,456")).toBeTruthy();
    expect(screen.queryByText(translate("unavailable"))).toBeNull();
    expect(screen.queryByText(translate("loadFailed"))).toBeNull();
  }
);

it("reports a network build failure and releases the busy state without claiming success", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...data,
          states: data.states.map((row) => ({ ...row, builtThisTurn: false })),
        }),
      })
      .mockRejectedValueOnce(new Error("Network unavailable"))
  );
  render(<StateOrganizationTab />);
  fireEvent.click(await screen.findByRole("button", { name: "Select Iowa" }));
  fireEvent.click(screen.getByRole("button", { name: /Build \(\+1\)/ }));
  expect(await screen.findByText(translate("buildFailed"))).toBeTruthy();
  expect(screen.getByText("2", { selector: "dd" })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Build \(\+1\)/ }).hasAttribute("disabled")).toBe(
    false
  );
});

it("falls back to the first remaining candidate when the selected candidate leaves the race", async () => {
  const spectatorData = { ...data, canBuild: false };
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => spectatorData })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...spectatorData,
          racePresence: [data.racePresence[0]],
        }),
      })
  );
  const { rerender } = render(<StateOrganizationTab />);
  fireEvent.click(await screen.findByRole("button", { name: "Rival" }));
  expect(screen.getByRole("button", { name: "Rival" }).getAttribute("aria-pressed")).toBe("true");
  clock.currentTurn = 13;
  rerender(<StateOrganizationTab />);
  await vi.waitFor(() => expect(screen.queryByRole("button", { name: "Rival" })).toBeNull());
  expect(screen.getByRole("button", { name: "Candidate (you)" }).getAttribute("aria-pressed")).toBe(
    "true"
  );
});

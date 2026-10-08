/** @vitest-environment happy-dom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TURN_STATUS_URL } from "@/lib/constants/statusPage";
import { TURN_STATUS_LINK_LABEL } from "./TurnStatusLink";

const mocks = vi.hoisted(() => ({
  gameState: null as null | Record<string, unknown>,
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/country/us" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    displayCurrencyPreference: "local",
    formatListingPrice: () => "",
    toInternalFrom: (n: number) => n,
    formatAmount: () => "",
    formatAmountChip: () => "",
    formatFull: () => "",
  }),
}));
vi.mock("@/contexts/AuthDataContext", () => ({
  useRefetchNav: () => () => {},
  useSignedIn: () => false,
  useAuthMe: () => ({ user: null, loading: false }),
}));
vi.mock("@/contexts/CharacterStatsContext", () => ({
  useCharacterStats: () => ({ stats: null, patchStats: () => {} }),
  buildStatusPatch: () => ({}),
}));
vi.mock("@/hooks/useGameEvents", () => ({
  useGameTurnStatus: () => mocks.gameState,
}));

import { StatusBar } from "../StatusBar";

function baseGameState(overrides: Record<string, unknown> = {}) {
  return {
    currentTurn: 10,
    startingYear: 1991,
    isActive: true,
    isProcessing: false,
    nextScheduledTurn: new Date(Date.now() + 30 * 60_000).toISOString(),
    pausedAt: null,
    ...overrides,
  };
}

describe("StatusBar turn status link", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 404 }))
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    mocks.gameState = null;
  });

  function expectLink() {
    const link = screen.getByRole("link", { name: TURN_STATUS_LINK_LABEL });
    expect(link.getAttribute("href")).toBe(TURN_STATUS_URL);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    return link;
  }

  it("links the countdown to the turn status page in multiplayer", () => {
    mocks.gameState = baseGameState();
    render(<StatusBar showOnlineStatus={false} turnStatusLink />);
    expect(TURN_STATUS_URL).toBe("https://status.lakesidegames.net/#ahd-turns");
    expectLink();
  });

  it("links the processing indicator in multiplayer", () => {
    mocks.gameState = baseGameState({ isProcessing: true });
    render(<StatusBar showOnlineStatus={false} turnStatusLink />);
    expect(expectLink().textContent).toContain("Turn processing");
  });

  it("renders no link in singleplayer", () => {
    mocks.gameState = baseGameState();
    const { unmount } = render(<StatusBar showOnlineStatus={false} turnStatusLink={false} />);
    expect(screen.queryByRole("link", { name: TURN_STATUS_LINK_LABEL })).toBeNull();
    unmount();

    mocks.gameState = baseGameState({ isProcessing: true });
    render(<StatusBar showOnlineStatus={false} turnStatusLink={false} />);
    expect(screen.queryByRole("link", { name: TURN_STATUS_LINK_LABEL })).toBeNull();
    expect(screen.getByText("Turn processing")).toBeTruthy();
  });
});

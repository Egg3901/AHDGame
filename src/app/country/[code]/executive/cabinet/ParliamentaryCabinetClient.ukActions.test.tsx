/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ParliamentaryCabinetClient from "./ParliamentaryCabinetClient";
import { PARLIAMENTARY_CABINET_CONFIGS } from "./parliamentaryCabinetConfig";

const { showToastMock } = vi.hoisted(() => ({ showToastMock: vi.fn() }));
const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn(() => true) }));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/components/HeroImage", () => ({
  HeroImage: (props: { src: string; alt: string }) => (
    // Test mock — bypass next/image so test runner doesn't need optimization pipeline.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={props.src} alt={props.alt} data-testid="hero-image" />
  ),
}));
vi.mock("@/components/Avatar", () => ({
  Avatar: () => <div data-testid="avatar" />,
}));
vi.mock("@/components/ui", () => ({
  Skeleton: () => <div data-testid="skeleton" />,
  Button: ({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...rest}>{children}</button>
  ),
}));
vi.mock("@/app/congress/components/CongressShared", () => ({
  PartyChip: () => <span data-testid="party-chip" />,
}));
vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: showToastMock }),
}));
vi.mock("@/hooks/useImperialPossessive", () => ({
  useImperialPossessive: () => "His Majesty's",
}));
vi.mock("./AppointModal", () => ({
  AppointModal: () => null,
}));

const SEATS = [
  {
    id: "chancellor",
    name: "Chancellor of the Exchequer",
    order: 2,
    isHeadOfGovernment: false,
    member: {
      characterId: "holder1",
      sequentialId: 11,
      characterName: "Alice Holder",
      confirmedAt: new Date().toISOString(),
    },
    cooldownUntil: null,
    nomination: null,
  },
  {
    id: "home_secretary",
    name: "Home Secretary",
    order: 3,
    isHeadOfGovernment: false,
    member: {
      characterId: "holder2",
      sequentialId: 22,
      characterName: "Bob Incumbent",
      confirmedAt: new Date().toISOString(),
    },
    cooldownUntil: null,
    nomination: null,
  },
];

const CANDIDATES = [
  { _id: "cand1", name: "Alice New", constituency: "Testshire" },
  { _id: "cand2", name: "Bob New", constituency: "Examford" },
];

let postHandlers: Record<string, { status: number; body: unknown }>;
let posted: Array<{ url: string; body: unknown }>;

function installFetch(opts: {
  isPrimeMinister?: boolean;
  reshuffle?: { available: boolean; reason: string };
  myPositionId?: string | null;
  whip?: unknown;
}) {
  posted = [];
  postHandlers = {};
  global.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      posted.push({ url: u, body });
      const key = Object.keys(postHandlers).find((suffix) => u.endsWith(suffix));
      const handler = key ? postHandlers[key] : undefined;
      if (!handler) {
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      }
      return {
        ok: handler.status >= 200 && handler.status < 300,
        status: handler.status,
        json: async () => handler.body,
      };
    }
    if (u.endsWith("/cabinet/whip")) {
      return { ok: true, status: 200, json: async () => opts.whip ?? { withdrawn: [] } };
    }
    if (u.endsWith("/cabinet/characters")) {
      return { ok: true, status: 200, json: async () => ({ characters: CANDIDATES }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        countryId: "UK",
        positions: SEATS,
        isPrimeMinister: opts.isPrimeMinister ?? false,
        isAdmin: false,
        governingPartyId: null,
        coalitionPartnerIds: [],
        reshuffle: opts.reshuffle ?? { available: true, reason: "reshuffle available" },
        myPositionId: opts.myPositionId ?? null,
      }),
    };
  }) as unknown as typeof fetch;
}

function renderUk() {
  render(<ParliamentaryCabinetClient config={PARLIAMENTARY_CABINET_CONFIGS.UK} />);
}

describe("UK cabinet actions (issue #859)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmMock.mockReturnValue(true);
    (globalThis as { confirm?: unknown }).confirm = confirmMock;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows reshuffle availability to the PM with a roster editor entry point", async () => {
    installFetch({ isPrimeMinister: true });
    renderUk();
    await waitFor(() => expect(screen.getByText("Cabinet Reshuffle")).toBeTruthy());
    expect(screen.getByText(/Reshuffle available/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open the cabinet reshuffle editor" })).toBeTruthy();
  });

  it("shows the spent reason and no editor when the token is used", async () => {
    installFetch({
      isPrimeMinister: true,
      reshuffle: { available: false, reason: "already reshuffled this parliament" },
    });
    renderUk();
    await waitFor(() => expect(screen.getByText("Cabinet Reshuffle")).toBeTruthy());
    expect(screen.getByText(/already reshuffled this parliament/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open the cabinet reshuffle editor" })).toBeNull();
  });

  it("submits the complete roster to the reshuffle endpoint", async () => {
    installFetch({ isPrimeMinister: true });
    renderUk();
    await waitFor(() => expect(screen.getByText("Cabinet Reshuffle")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Open the cabinet reshuffle editor" }));

    await waitFor(() =>
      expect(screen.getByLabelText("New minister for Chancellor of the Exchequer")).toBeTruthy()
    );
    fireEvent.change(screen.getByLabelText("New minister for Chancellor of the Exchequer"), {
      target: { value: "cand1" },
    });
    fireEvent.change(screen.getByLabelText("New minister for Home Secretary"), {
      target: { value: "cand2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit the new cabinet roster" }));

    await waitFor(() =>
      expect(posted.some((p) => p.url.endsWith("/cabinet/reshuffle"))).toBe(true)
    );
    const reshufflePost = posted.find((p) => p.url.endsWith("/cabinet/reshuffle"))!;
    expect(reshufflePost.body).toEqual({
      appointments: [
        { positionId: "chancellor", characterId: "cand1" },
        { positionId: "home_secretary", characterId: "cand2" },
      ],
    });
    expect(confirmMock).toHaveBeenCalled();
    expect(showToastMock.mock.calls.some(([, kind]) => kind === "success")).toBe(true);
  });

  it("surfaces a reshuffle conflict without posting twice", async () => {
    installFetch({ isPrimeMinister: true });
    renderUk();
    await waitFor(() => expect(screen.getByText("Cabinet Reshuffle")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Open the cabinet reshuffle editor" }));
    await waitFor(() =>
      expect(screen.getByLabelText("New minister for Chancellor of the Exchequer")).toBeTruthy()
    );
    postHandlers["/cabinet/reshuffle"] = {
      status: 409,
      body: { error: "Cabinet reshuffle already used for this parliament" },
    };
    fireEvent.change(screen.getByLabelText("New minister for Chancellor of the Exchequer"), {
      target: { value: "cand1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit the new cabinet roster" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("already used");
    expect(showToastMock).toHaveBeenCalledWith(expect.stringContaining("already used"), "error");
    expect(posted.filter((p) => p.url.endsWith("/cabinet/reshuffle"))).toHaveLength(1);
  });

  it("rejects a roster that seats one minister twice", async () => {
    installFetch({ isPrimeMinister: true });
    renderUk();
    await waitFor(() => expect(screen.getByText("Cabinet Reshuffle")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Open the cabinet reshuffle editor" }));
    await waitFor(() =>
      expect(screen.getByLabelText("New minister for Chancellor of the Exchequer")).toBeTruthy()
    );
    fireEvent.change(screen.getByLabelText("New minister for Chancellor of the Exchequer"), {
      target: { value: "cand1" },
    });
    fireEvent.change(screen.getByLabelText("New minister for Home Secretary"), {
      target: { value: "cand1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit the new cabinet roster" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("only hold one cabinet seat");
    expect(posted.some((p) => p.url.endsWith("/cabinet/reshuffle"))).toBe(false);
  });

  it("shows Resign only on the holder's seat and posts to the resign endpoint", async () => {
    installFetch({ myPositionId: "chancellor" });
    renderUk();
    await waitFor(() => expect(screen.getByText("Chancellor of the Exchequer")).toBeTruthy());

    const resignButtons = screen.getAllByRole("button", { name: /Resign as/ });
    expect(resignButtons).toHaveLength(1);
    expect(resignButtons[0].getAttribute("aria-label")).toBe(
      "Resign as Chancellor of the Exchequer"
    );

    fireEvent.click(resignButtons[0]);
    await waitFor(() => expect(posted.some((p) => p.url.endsWith("/cabinet/resign"))).toBe(true));
    expect(posted.find((p) => p.url.endsWith("/cabinet/resign"))!.body).toEqual({
      positionId: "chancellor",
    });
    expect(confirmMock).toHaveBeenCalled();
    expect(showToastMock.mock.calls.some(([, kind]) => kind === "success")).toBe(true);
  });

  it("shows no Resign button to a viewer who holds no seat", async () => {
    installFetch({ myPositionId: null });
    renderUk();
    await waitFor(() => expect(screen.getByText("Chancellor of the Exchequer")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Resign as/ })).toBeNull();
  });

  it("surfaces a resign conflict when the seat is already lost", async () => {
    installFetch({ myPositionId: "chancellor" });
    postHandlers["/cabinet/resign"] = {
      status: 404,
      body: { error: "You do not hold this cabinet seat" },
    };
    renderUk();
    await waitFor(() => expect(screen.getByRole("button", { name: /Resign as/ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Resign as/ }));
    await waitFor(() =>
      expect(showToastMock).toHaveBeenCalledWith("You do not hold this cabinet seat", "error")
    );
  });

  it("withdraws and restores the whip through the correct endpoints", async () => {
    const targetId = "0123456789abcdef01234567";
    installFetch({
      isPrimeMinister: true,
      whip: {
        withdrawn: [
          {
            characterId: targetId,
            characterName: "Rebel MP",
            constituency: "Testshire",
            party: "1",
            whipWithdrawnAt: new Date(0).toISOString(),
            reselectionRisk: "elevated",
          },
        ],
      },
    });
    renderUk();
    await waitFor(() => expect(screen.getByText("Party Whip")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("Whip withdrawn")).toBeTruthy());
    expect(screen.getByText(/Reselection risk: elevated/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Character ID of the MP to suspend"), {
      target: { value: targetId },
    });
    fireEvent.click(screen.getByRole("button", { name: "Withdraw the whip from this MP" }));
    await waitFor(() =>
      expect(posted.some((p) => p.url.endsWith("/cabinet/whip/withdraw"))).toBe(true)
    );
    expect(posted.find((p) => p.url.endsWith("/cabinet/whip/withdraw"))!.body).toEqual({
      characterId: targetId,
    });

    fireEvent.click(screen.getByRole("button", { name: "Restore the whip to Rebel MP" }));
    await waitFor(() =>
      expect(posted.some((p) => p.url.endsWith("/cabinet/whip/restore"))).toBe(true)
    );
    expect(posted.find((p) => p.url.endsWith("/cabinet/whip/restore"))!.body).toEqual({
      characterId: targetId,
    });
  });

  it("surfaces whip validation errors and forbidden state", async () => {
    installFetch({ isPrimeMinister: true, whip: { withdrawn: [] } });
    postHandlers["/cabinet/whip/withdraw"] = {
      status: 400,
      body: { error: "Invalid character ID" },
    };
    renderUk();
    await waitFor(() => expect(screen.getByText("Party Whip")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Character ID of the MP to suspend"), {
      target: { value: "nope" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Withdraw the whip from this MP" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("Invalid character ID");

    postHandlers["/cabinet/whip/withdraw"] = {
      status: 403,
      body: { error: "The whip can only be withdrawn from MPs of the governing party" },
    };
    fireEvent.click(screen.getByRole("button", { name: "Withdraw the whip from this MP" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("governing party"));
  });

  it("hides the whip panel from non-PM viewers and never calls the whip endpoint", async () => {
    installFetch({ isPrimeMinister: false });
    renderUk();
    await waitFor(() => expect(screen.getByText("Cabinet Reshuffle")).toBeTruthy());
    expect(screen.queryByText("Party Whip")).toBeNull();
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(
      vi.mocked(fetchMock).mock.calls.some(([url]) => String(url).endsWith("/cabinet/whip"))
    ).toBe(false);
  });
});

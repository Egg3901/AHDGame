/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ParliamentaryCabinetClient from "./ParliamentaryCabinetClient";
import { PARLIAMENTARY_CABINET_CONFIGS } from "./parliamentaryCabinetConfig";

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
  useToast: () => ({ showToast: vi.fn() }),
}));
vi.mock("@/hooks/useImperialPossessive", () => ({
  useImperialPossessive: () => "His Majesty's",
}));
vi.mock("./AppointModal", () => ({
  AppointModal: () => <div data-testid="appoint-modal" />,
}));

function mockFetch(
  positions: unknown[],
  isPrimeMinister: boolean = false,
  isAdmin: boolean = false
) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      countryId: "DE",
      positions,
      isPrimeMinister,
      isAdmin,
      governingPartyId: null,
      coalitionPartnerIds: [],
    }),
  }) as unknown as typeof fetch;
}

describe("ParliamentaryCabinetClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the DE hero title and tagline from config", async () => {
    mockFetch([]);
    render(<ParliamentaryCabinetClient config={PARLIAMENTARY_CABINET_CONFIGS.DE} />);
    await waitFor(() => expect(screen.getByText("Cabinet of Germany")).toBeTruthy());
    expect(
      screen.getByText("Bundeskanzleramt · Federal ministers appointed by the Chancellor")
    ).toBeTruthy();
  });

  it("uses the imperial possessive for the UK title", async () => {
    mockFetch([]);
    render(<ParliamentaryCabinetClient config={PARLIAMENTARY_CABINET_CONFIGS.UK} />);
    await waitFor(() => expect(screen.getByText("His Majesty's Cabinet")).toBeTruthy());
  });

  it("renders all positions from the JP config", async () => {
    const jpPositions = PARLIAMENTARY_CABINET_CONFIGS.JP.positions.slice(0, 3);
    mockFetch(
      jpPositions.map((p) => ({
        id: p.id,
        name: p.name,
        order: p.order ?? 0,
        member: null,
        cooldownUntil: null,
        nomination: null,
      }))
    );
    render(<ParliamentaryCabinetClient config={PARLIAMENTARY_CABINET_CONFIGS.JP} />);
    await waitFor(() => expect(screen.getByText("Cabinet of Japan")).toBeTruthy());
    for (const pos of jpPositions) {
      expect(screen.getByText(pos.name)).toBeTruthy();
    }
  });

  it("shows the Fire button only when the viewer is PM and the member is filled", async () => {
    // Use a portfolio ministry (not the head-of-government seat, which is read-only).
    const portfolioPos = PARLIAMENTARY_CABINET_CONFIGS.CN.positions[1];
    mockFetch(
      [
        {
          id: portfolioPos.id,
          name: portfolioPos.name,
          order: 1,
          member: {
            characterId: "char_1",
            characterName: "Wang Xi",
            confirmedAt: new Date().toISOString(),
          },
          cooldownUntil: null,
          nomination: null,
        },
      ],
      true // isPrimeMinister
    );
    render(<ParliamentaryCabinetClient config={PARLIAMENTARY_CABINET_CONFIGS.CN} />);
    await waitFor(() => expect(screen.getByText("Fire")).toBeTruthy());
  });

  it("renders the head-of-government seat read-only (no Fire / View Office) even for a PM viewer", async () => {
    const premier = PARLIAMENTARY_CABINET_CONFIGS.CN.positions[0]; // Premier of the State Council
    mockFetch(
      [
        {
          id: premier.id,
          name: premier.name,
          order: 0,
          isHeadOfGovernment: true,
          member: {
            characterId: "pm_1",
            characterName: "Premier Li",
            confirmedAt: new Date().toISOString(),
          },
          cooldownUntil: null,
          nomination: null,
        },
      ],
      true // isPrimeMinister
    );
    render(<ParliamentaryCabinetClient config={PARLIAMENTARY_CABINET_CONFIGS.CN} />);
    await waitFor(() => expect(screen.getByText("Premier Li")).toBeTruthy());

    // The auto-assigned head of government is the only filled seat, so no Fire
    // button should appear anywhere; and its card omits the "View Office" link.
    // The client renders exactly the API roster (year-resolved server-side),
    // and the mocked response contains only the head-of-government seat — so
    // no View Office link renders at all.
    expect(screen.queryByText("Fire")).toBeNull();
    expect(screen.queryAllByText("View Office →").length).toBe(0);
  });

  it("hides the Fire button when the viewer is not PM", async () => {
    const firstPos = PARLIAMENTARY_CABINET_CONFIGS.CN.positions[0];
    mockFetch(
      [
        {
          id: firstPos.id,
          name: firstPos.name,
          order: 0,
          member: {
            characterId: "char_1",
            characterName: "Wang Xi",
            confirmedAt: new Date().toISOString(),
          },
          cooldownUntil: null,
          nomination: null,
        },
      ],
      false
    );
    render(<ParliamentaryCabinetClient config={PARLIAMENTARY_CABINET_CONFIGS.CN} />);
    await waitFor(() => expect(screen.getByText(firstPos.name)).toBeTruthy());
    expect(screen.queryByText("Fire")).toBeNull();
  });

  it("renders Vacant when no member is appointed and not on cooldown", async () => {
    const firstPos = PARLIAMENTARY_CABINET_CONFIGS.DE.positions[0];
    mockFetch([
      {
        id: firstPos.id,
        name: firstPos.name,
        order: 0,
        member: null,
        cooldownUntil: null,
        nomination: null,
      },
    ]);
    render(<ParliamentaryCabinetClient config={PARLIAMENTARY_CABINET_CONFIGS.DE} />);
    // Every position (the one mocked + all the other config positions without
    // matching data) renders Vacant when there's no member and no cooldown.
    await waitFor(() => expect(screen.getAllByText("Vacant").length).toBeGreaterThan(0));
  });

  it("hides the Admin tab from non-admin viewers", async () => {
    mockFetch([]);
    render(<ParliamentaryCabinetClient config={PARLIAMENTARY_CABINET_CONFIGS.DE} />);
    await waitFor(() => expect(screen.getByText("Overview")).toBeTruthy());
    expect(screen.queryByText("Admin")).toBeNull();
  });

  it("shows the Admin tab to admins and switches to the admin panel", async () => {
    const firstPos = PARLIAMENTARY_CABINET_CONFIGS.DE.positions[0];
    mockFetch(
      [
        {
          id: firstPos.id,
          name: firstPos.name,
          order: 0,
          member: null,
          cooldownUntil: null,
          nomination: null,
        },
      ],
      false,
      true // isAdmin
    );
    render(<ParliamentaryCabinetClient config={PARLIAMENTARY_CABINET_CONFIGS.DE} />);
    await waitFor(() => expect(screen.getByText("Admin")).toBeTruthy());

    fireEvent.click(screen.getByText("Admin"));
    expect(screen.getByTestId("cabinet-admin-tab")).toBeTruthy();
    expect(screen.getByText("Direct Appointment (Admin)")).toBeTruthy();
    // Overview content is hidden while the admin tab is active.
    expect(screen.queryByText("Cabinet Positions")).toBeNull();
  });

  it("hits the correct executive API URL for the country", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        countryId: "UK",
        positions: [],
        isPrimeMinister: false,
        isAdmin: false,
        governingPartyId: null,
        coalitionPartnerIds: [],
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<ParliamentaryCabinetClient config={PARLIAMENTARY_CABINET_CONFIGS.UK} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/country/uk/executive/cabinet")
    );
  });
});

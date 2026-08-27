/**
 * @vitest-environment happy-dom
 *
 * The acting-appointment surface. Before this existed the endpoint had no
 * caller at all, which is why departments sat unhelmed.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import PresidentialCabinetClient from "./PresidentialCabinetClient";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/components/HeroImage", () => ({
  HeroImage: (props: { src: string; alt: string }) => (
    // Test mock — bypass next/image so the runner needs no optimization pipeline.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={props.src} alt={props.alt} data-testid="hero-image" />
  ),
}));
vi.mock("@/components/Avatar", () => ({
  Avatar: () => <div data-testid="avatar" />,
}));
vi.mock("@/components/ui", () => ({
  Skeleton: () => <div data-testid="skeleton" />,
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
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
vi.mock("@/app/whitehouse/cabinet/components/CabinetVoteRow", () => ({
  CabinetVoteRow: () => <div data-testid="vote-row" />,
}));
vi.mock("@/app/whitehouse/cabinet/components/CabinetNominateModal", () => ({
  CabinetNominateModal: () => <div data-testid="nominate-modal" />,
}));
vi.mock("./CabinetAdminTab", () => ({ CabinetAdminTab: () => <div /> }));
vi.mock("./CabinetTabNav", () => ({
  CabinetTabNav: () => <div data-testid="tab-nav" />,
}));

const TREASURY = {
  id: "secretary_of_treasury",
  name: "Secretary of the Treasury",
  order: 2,
};

function mockFetch(body: Record<string, unknown>) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      isPresident: true,
      isSenator: false,
      isAdmin: false,
      currentTurn: 410,
      actingEnabled: true,
      actingTenureTurns: 24,
      ...body,
    }),
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PresidentialCabinetClient acting appointments", () => {
  it("offers the President an acting appointment on a vacant seat", async () => {
    mockFetch({
      positions: [{ ...TREASURY, member: null, nomination: null, actingChargeSpent: false }],
    });
    render(<PresidentialCabinetClient countryId="US" />);

    const button = (await screen.findByRole("button", {
      name: /appoint acting/i,
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it("disables the control once the seat's acting appointment is spent, and says why", async () => {
    mockFetch({
      positions: [{ ...TREASURY, member: null, nomination: null, actingChargeSpent: true }],
    });
    render(<PresidentialCabinetClient countryId="US" />);

    const button = (await screen.findByRole("button", {
      name: /appoint acting/i,
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/only be filled by confirmation now/i)).toBeTruthy();
  });

  it("badges a seated acting holder with the turns they have left", async () => {
    mockFetch({
      positions: [
        {
          ...TREASURY,
          member: {
            characterId: "aaaaaaaaaaaaaaaaaaaaaaaa",
            characterName: "Acting Secretary",
            confirmedAt: new Date(0).toISOString(),
            acting: true,
            actingExpiresOnTurn: 424,
          },
          nomination: null,
          actingChargeSpent: true,
        },
      ],
    });
    render(<PresidentialCabinetClient countryId="US" />);

    expect(await screen.findByText("Acting")).toBeTruthy();
    expect(screen.getByText(/14 turns remaining/i)).toBeTruthy();
  });

  it("hides the control in a country that does not run acting appointments", async () => {
    mockFetch({
      actingEnabled: false,
      positions: [{ ...TREASURY, member: null, nomination: null, actingChargeSpent: false }],
    });
    render(<PresidentialCabinetClient countryId="US" />);

    // The nominate control still renders, so this is the acting one being absent
    // rather than the seat failing to render at all.
    expect(await screen.findByRole("button", { name: /^nominate$/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /appoint acting/i })).toBeNull();
  });
});

/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Character, PoliticalParty } from "@/lib/db/types";
import { ProfileHeader } from "./ProfileHeader";
import enProfile from "../../../../messages/en/profile.json";

function render(ui: React.ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enProfile}>
      {ui}
    </NextIntlClientProvider>
  );
}

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    title,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    title?: string;
    className?: string;
  }) => (
    <a href={href} title={title} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={String(props.src ?? "")} alt={String(props.alt ?? "")} />
  ),
}));

vi.mock("@/components/CountryFlag", () => ({
  CountryFlag: ({ title }: { title?: string }) => <span title={title}>flag</span>,
}));

vi.mock("@/components/ProfilePictureUpload", () => ({
  ProfilePictureUpload: () => <div data-testid="pfp-upload" />,
}));

vi.mock("./ProfilePictureLightbox", () => ({
  ProfilePictureLightbox: () => <div data-testid="pfp-lightbox" />,
}));

/** Captures what ProfileHeader hands the badge, so prop forwarding is testable
 *  without rendering the badge's own markup. */
const patreonBadgeProps: Record<string, unknown>[] = [];
vi.mock("@/components/patreon/PatreonBadge", () => ({
  PatreonBadge: (props: Record<string, unknown>) => {
    patreonBadgeProps.push(props);
    return null;
  },
}));

vi.mock("@/components/CampaignSongPlayer", () => ({
  CampaignSongPlayer: () => null,
}));

vi.mock("./CopyProfileLinkButton", () => ({
  CopyProfileLinkButton: () => null,
}));

const baseCharacter = {
  name: "Egg",
  homeState: "DD_NOR",
  countryId: "DD",
  party: "1",
  avatarUrl: null,
  profileHeaderImageUrl: null,
  bio: null,
} as unknown as Character;

const baseParty = {
  name: "Sozialistische Einheitspartei Deutschlands",
  abbreviation: "SED",
  color: "#E3000F",
  sequentialId: 1,
} as unknown as PoliticalParty;

const baseProps = {
  character: baseCharacter,
  party: baseParty,
  user: { username: "egg3901", isAdmin: false, isModerator: false },
  memberSince: "July 22, 2026",
  officeLabels: ["Private Citizen"],
  stateLabel: "Northern Districts",
  countrySlug: "dd",
};

describe("ProfileHeader membership date", () => {
  it("shows a precise account date without a history footnote", () => {
    render(<ProfileHeader {...baseProps} />);
    expect(screen.getByText("Member since July 22, 2026")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "About this join date" })).toBeNull();
  });

  it("explains earlier lost history when the asterisk is tapped", () => {
    render(<ProfileHeader {...baseProps} memberSinceIsApproximate />);
    expect(screen.getByText("Member since July 22, 2026 or earlier")).toBeTruthy();
    const footnote = screen.getByRole("button", { name: "About this join date" });
    expect(footnote.textContent).toBe("*");
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.click(footnote);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toContain(
      "Account creation data from earlier iterations was lost."
    );
    expect(footnote.getAttribute("aria-describedby")).toBe(tooltip.id);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("opens the history footnote with the keyboard and dismisses it on blur", () => {
    render(<ProfileHeader {...baseProps} memberSinceIsApproximate />);
    const footnote = screen.getByRole("button", { name: "About this join date" });
    const matches = vi.spyOn(footnote, "matches").mockReturnValue(true);
    fireEvent.focus(footnote);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.blur(footnote);
    expect(screen.queryByRole("tooltip")).toBeNull();
    matches.mockRestore();
  });
});

describe("ProfileHeader region badge", () => {
  it("shows the resolved region name, not the opaque state id", () => {
    render(<ProfileHeader {...baseProps} />);

    const regionLink = screen.getByRole("link", { name: "Northern Districts" });
    expect(regionLink.getAttribute("href")).toBe("/country/dd/region/DD_NOR");
    expect(regionLink.getAttribute("title")).toBe("Northern Districts");
    expect(screen.queryByText("DD_NOR")).toBeNull();
  });

  it("falls back to the state id when that is the only available label", () => {
    render(
      <ProfileHeader
        {...baseProps}
        character={{ ...baseCharacter, homeState: "XY_Z" } as Character}
        stateLabel="XY_Z"
      />
    );

    expect(screen.getByRole("link", { name: "XY_Z" })).toBeTruthy();
  });
});

describe("ProfileHeader office badges", () => {
  it("shows each current leadership and office label", () => {
    render(
      <ProfileHeader
        {...baseProps}
        officeLabels={[
          "Speaker of the House",
          "Acting Secretary of the Treasury",
          "Representative (CA, District 15)",
        ]}
      />
    );

    expect(screen.getByText("Speaker of the House")).toBeTruthy();
    expect(screen.getByText("Acting Secretary of the Treasury")).toBeTruthy();
    expect(screen.getByText("Representative (CA, District 15)")).toBeTruthy();
  });
});

describe("supporter provider", () => {
  /**
   * PatreonBadge has always accepted a `provider` so a Lakeside subscription
   * reads differently from a Patreon pledge. Nothing ever passed it, so every
   * supporter was described as a Patreon patron regardless of who they paid.
   * The badge renders its own copy; what this file owns is the forwarding.
   */
  beforeEach(() => {
    patreonBadgeProps.length = 0;
  });

  it("forwards the supporter provider to the badge", () => {
    render(<ProfileHeader {...baseProps} patreonTier="supporter" supporterProvider="stripe" />);

    expect(patreonBadgeProps.at(-1)).toMatchObject({
      tier: "supporter",
      provider: "stripe",
    });
  });

  it("forwards patreon as the provider when that is who granted it", () => {
    render(
      <ProfileHeader {...baseProps} patreonTier="supporter-plus" supporterProvider="patreon" />
    );

    expect(patreonBadgeProps.at(-1)).toMatchObject({
      tier: "supporter-plus",
      provider: "patreon",
    });
  });

  it("sends undefined rather than null when there is no provider", () => {
    // The badge's prop is optional; passing null would defeat its own default.
    render(<ProfileHeader {...baseProps} patreonTier="supporter" supporterProvider={null} />);

    expect(patreonBadgeProps.at(-1)?.provider).toBeUndefined();
  });
});

describe("ProfileHeader identity block", () => {
  it("names the party once, with a single colour swatch and no strip or gradient", () => {
    const { container } = render(<ProfileHeader {...baseProps} />);

    const partyLink = screen.getByRole("link", { name: baseParty.name });
    expect(partyLink.getAttribute("href")).toBe("/country/dd/parties/1");
    const coloured = container.querySelectorAll<HTMLElement>("[style*='background']");
    expect(coloured).toHaveLength(1);
    expect(partyLink.contains(coloured[0])).toBe(true);
    expect(container.innerHTML).not.toContain("gradient");
  });

  it("reads Independent for a player outside any party", () => {
    render(
      <ProfileHeader
        {...baseProps}
        party={null}
        character={{ ...baseCharacter, party: "independent" } as Character}
      />
    );
    expect(screen.getByText("Independent")).toBeTruthy();
  });

  it("shows the biography as plain text", () => {
    render(
      <ProfileHeader
        {...baseProps}
        character={{ ...baseCharacter, bio: "Builds railways." } as Character}
      />
    );
    const bio = screen.getByText("Builds railways.");
    expect(bio.tagName).toBe("P");
    expect(bio.className).not.toContain("border-l");
  });

  it("hides the biography from a viewer who blocked the player", () => {
    render(
      <ProfileHeader
        {...baseProps}
        character={{ ...baseCharacter, bio: "Builds railways." } as Character}
        bioHidden
      />
    );
    expect(screen.queryByText("Builds railways.")).toBeNull();
    expect(screen.queryByText(/has not published a public biography/)).toBeNull();
  });
});

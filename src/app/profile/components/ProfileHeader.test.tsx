/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
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

vi.mock("@/components/patreon/PatreonBadge", () => ({
  PatreonBadge: () => null,
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
  officeLabel: "Private Citizen",
  stateLabel: "Northern Districts",
  countrySlug: "dd",
};

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

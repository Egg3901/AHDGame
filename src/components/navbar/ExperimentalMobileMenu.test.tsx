/** @vitest-environment happy-dom */
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import enNav from "../../../messages/en/nav.json";
import {
  ExperimentalMobileMenu,
  MobileCharacterSwitcher,
  type ExperimentalMobileMenuProps,
} from "./ExperimentalMobileMenu";

function renderSwitcher(props: Partial<React.ComponentProps<typeof MobileCharacterSwitcher>> = {}) {
  const defaults: React.ComponentProps<typeof MobileCharacterSwitcher> = {
    adminCharacters: [
      { id: "one", name: "Alice", countryId: "US", party: null, isActive: true },
      { id: "two", name: "Bob", countryId: "UK", party: null, isActive: false },
    ],
    isImperialMode: false,
    switchingCharacter: false,
    switchingImperial: false,
    onClose: vi.fn(),
    handleSwitchCharacter: vi.fn(async () => {}),
    handleSwitchImperial: vi.fn(async () => {}),
  };
  return render(
    <NextIntlClientProvider locale="en" messages={enNav}>
      <MobileCharacterSwitcher {...defaults} {...props} />
    </NextIntlClientProvider>
  );
}

describe("MobileCharacterSwitcher", () => {
  it("shows the active character and switches to another character", () => {
    const handleSwitchCharacter = vi.fn(async () => {});
    const onClose = vi.fn();
    renderSwitcher({ handleSwitchCharacter, onClose });

    expect(screen.getByRole("link", { name: /Alice Active/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Bob UK/i }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(handleSwitchCharacter).toHaveBeenCalledWith("two");
  });

  it("can return from imperial mode to a regular character", () => {
    const handleSwitchImperial = vi.fn(async () => {});
    renderSwitcher({
      isImperialMode: true,
      imperialCharacter: { id: "king", name: "The King" },
      handleSwitchImperial,
    });

    fireEvent.click(screen.getByRole("button", { name: /Alice US/i }));
    expect(handleSwitchImperial).toHaveBeenCalledWith("character");
    expect(screen.getByRole("link", { name: /The King Active/i }).getAttribute("href")).toBe(
      "/imperial/king"
    );
  });
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/profile",
}));
vi.mock("@/lib/analytics/capture", () => ({ captureProductEvent: vi.fn() }));
afterEach(() => vi.unstubAllEnvs());

const menuProps: ExperimentalMobileMenuProps = {
  navItems: [],
  pathname: "/profile",
  mobileSubOpen: {},
  toggleMobileSub: vi.fn(),
  onClose: vi.fn(),
  user: { username: "demonstration" },
  showProfile: true,
  profileDisplayName: "Demonstration character",
  unreadCount: 0,
  isImperialMode: false,
  switchingCharacter: false,
  switchingImperial: false,
  handleSwitchCharacter: vi.fn(async () => {}),
  handleSwitchImperial: vi.fn(async () => {}),
  stateLegislatureLabel: "State legislature",
  pageCountry: "US",
  userCountry: "US",
  switchableCountries: [],
  worldSubItems: [],
  profileOrgItems: [],
  staffSubItems: [],
  charterEntry: null,
  hasActiveReferendumCampaign: false,
  showWiki: false,
  feedbackCapturing: false,
  handleSignOut: vi.fn(),
};

describe("mobile release footer", () => {
  it.each([
    { profileOnly: true, navigationVariant: "b" as const },
    { profileOnly: false, navigationVariant: "b" as const },
    { profileOnly: false, navigationVariant: "a" as const },
  ])(
    "links the displayed version to the changelog for $navigationVariant / profile $profileOnly",
    (variant) => {
      vi.stubEnv("NEXT_PUBLIC_APP_VERSION", "1.13.0");
      vi.stubEnv("NEXT_PUBLIC_GIT_COMMIT", "abcdef0");
      const onClose = vi.fn();
      const { container } = render(
        <NextIntlClientProvider locale="en" messages={enNav}>
          <ExperimentalMobileMenu {...menuProps} {...variant} onClose={onClose} />
        </NextIntlClientProvider>
      );
      const link = screen.getByRole("link", { name: "v1.13.0 · abcdef0" });
      expect(link.getAttribute("href")).toBe("/changelog");
      if (variant.navigationVariant === "b") expect(container.firstChild?.lastChild).toBe(link);
      fireEvent.click(link);
      expect(onClose).toHaveBeenCalledOnce();
    }
  );
});

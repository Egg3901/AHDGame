/** @vitest-environment happy-dom */
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import enNav from "../../../messages/en/nav.json";
import { MobileCharacterSwitcher } from "./ExperimentalMobileMenu";

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

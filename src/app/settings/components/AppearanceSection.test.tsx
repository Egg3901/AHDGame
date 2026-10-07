// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppearanceSection } from "./AppearanceSection";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "default", setTheme: vi.fn() }),
}));

vi.mock("./LanguageSection", () => ({ LanguageSection: () => null }));
vi.mock("@/lib/observability/fetchJson", () => ({ fetchJson: vi.fn() }));

afterEach(cleanup);

describe("AppearanceSection interface selector", () => {
  it("shows both modes and selects the persisted mode", () => {
    render(
      <AppearanceSection
        interfaceMode="classic"
        interfaceModeSaving={false}
        onInterfaceModeChange={vi.fn()}
      />
    );

    const modern = screen.getByRole("radio", {
      name: /appearance\.modernUi/,
    }) as HTMLInputElement;
    const classic = screen.getByRole("radio", {
      name: /appearance\.classicUi/,
    }) as HTMLInputElement;

    expect(modern.checked).toBe(false);
    expect(classic.checked).toBe(true);
  });

  it("reports a modern or classic selection", () => {
    const onChange = vi.fn();
    render(
      <AppearanceSection
        interfaceMode="modern"
        interfaceModeSaving={false}
        onInterfaceModeChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole("radio", { name: /appearance\.classicUi/ }));

    expect(onChange).toHaveBeenCalledWith("classic");
  });

  it("prevents overlapping selections while the preference is saving", () => {
    render(
      <AppearanceSection
        interfaceMode="modern"
        interfaceModeSaving
        onInterfaceModeChange={vi.fn()}
      />
    );

    expect(
      (screen.getByRole("radio", { name: /appearance\.modernUi/ }) as HTMLInputElement).disabled
    ).toBe(true);
    expect(
      (screen.getByRole("radio", { name: /appearance\.classicUi/ }) as HTMLInputElement).disabled
    ).toBe(true);
  });
});

/** @vitest-environment happy-dom */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CabinetPositionRail } from "./CabinetPositionRail";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(cleanup);

describe("CabinetPositionRail", () => {
  it("lists US seats grouped, linking to each office route, marking the active seat", () => {
    render(
      <CabinetPositionRail
        countryCode="us"
        countryId="US"
        activePositionId="secretary_of_defense"
      />
    );

    expect(screen.getByText("Security & Foreign")).toBeTruthy();
    expect(screen.getByText("Economy")).toBeTruthy();

    const treasuryLink = screen
      .getAllByRole("link")
      .find((a) => a.getAttribute("href")?.includes("secretary_of_treasury"));
    expect(treasuryLink?.getAttribute("href")).toBe(
      "/country/us/executive/cabinet/secretary_of_treasury/office"
    );

    const activeLink = screen
      .getAllByRole("link")
      .find((a) => a.getAttribute("href")?.includes("secretary_of_defense"));
    expect(activeLink?.getAttribute("aria-current")).toBe("page");
  });
});

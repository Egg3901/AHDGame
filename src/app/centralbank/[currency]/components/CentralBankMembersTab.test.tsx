/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CentralBankMembersTab } from "./CentralBankMembersTab";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/components/CountryFlag", () => ({
  CountryFlag: ({ country }: { country: string }) => <div data-testid={`flag-${country}`} />,
}));

describe("CentralBankMembersTab", () => {
  const members = [
    { countryId: "UK" as const, name: "United Kingdom", isIssuer: true },
    { countryId: "SCO" as const, name: "Scotland", isIssuer: false },
  ];

  it("renders one row per member linking to the country page", () => {
    render(<CentralBankMembersTab members={members} />);
    expect(screen.getByText("United Kingdom").closest("a")?.getAttribute("href")).toBe(
      "/country/uk"
    );
    expect(screen.getByText("Scotland").closest("a")?.getAttribute("href")).toBe("/country/sco");
  });

  it("marks only the issuer with a badge", () => {
    render(<CentralBankMembersTab members={members} />);
    expect(screen.getAllByText("Issuer")).toHaveLength(1);
  });
});

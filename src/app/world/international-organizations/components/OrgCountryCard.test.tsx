/** @vitest-environment happy-dom */
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { OrgCountryCard } from "./OrgCountryCard";
import { resolveOrgIdentity } from "@/lib/constants/orgIdentity";
import type { OrgSummary } from "../orgTypes";

afterEach(() => cleanup());

function org(id: string, name: string): OrgSummary {
  return {
    id,
    def: { id, name, shortName: id, category: "economic" },
    identity: resolveOrgIdentity(id, false, name, "economic"),
  } as unknown as OrgSummary;
}

describe("OrgCountryCard", () => {
  it("lists the country's orgs as links to their pages", () => {
    render(
      <OrgCountryCard
        countryId="DE"
        orgs={[org("EU", "European Union")]}
        position={{ x: 10, y: 10 }}
        onClose={() => {}}
      />
    );
    expect(screen.getByText("Germany")).toBeTruthy();
    expect(screen.getByText("European Union").closest("a")?.getAttribute("href")).toBe(
      "/world/international-organizations/eu"
    );
  });

  it("shows an empty state when the country has no memberships", () => {
    render(
      <OrgCountryCard countryId="BR" orgs={[]} position={{ x: 0, y: 0 }} onClose={() => {}} />
    );
    expect(screen.getByText(/not a member/i)).toBeTruthy();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<OrgCountryCard countryId="DE" orgs={[]} position={{ x: 0, y: 0 }} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
  });
});

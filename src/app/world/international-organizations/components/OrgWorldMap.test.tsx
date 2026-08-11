/** @vitest-environment happy-dom */
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { OrgWorldMap } from "./OrgWorldMap";
import { resolveOrgIdentity } from "@/lib/constants/orgIdentity";
import type { OrgSummary } from "../orgTypes";

afterEach(() => cleanup());

function org(id: string, name: string, members: string[]): OrgSummary {
  return {
    id,
    def: { id, name, shortName: id, category: "economic" },
    members: members.map((c) => ({ countryId: c })),
    identity: resolveOrgIdentity(id, false, name, "economic"),
  } as unknown as OrgSummary;
}

const orgs = [org("EU", "European Union", ["DE", "IE"]), org("NATO", "NATO", ["DE", "US"])];

describe("OrgWorldMap", () => {
  it("renders a selector chip per org with the first selected by default", () => {
    render(<OrgWorldMap orgs={orgs} />);
    const eu = screen.getByRole("button", { name: "EU" });
    const nato = screen.getByRole("button", { name: "NATO" });
    expect(eu.getAttribute("aria-pressed")).toBe("true");
    expect(nato.getAttribute("aria-pressed")).toBe("false");
  });

  it("changes the selected org (and legend) when another chip is clicked", () => {
    render(<OrgWorldMap orgs={orgs} />);
    expect(screen.getByText(/Members of European Union/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "NATO" }));
    expect(screen.getByRole("button", { name: "NATO" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/Members of NATO/i)).toBeTruthy();
  });

  it("renders an empty state when there are no orgs", () => {
    render(<OrgWorldMap orgs={[]} />);
    expect(screen.getByText(/No organizations to map/i)).toBeTruthy();
  });
});

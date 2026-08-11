/** @vitest-environment happy-dom */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReferendumMasthead } from "./ReferendumMasthead";

describe("ReferendumMasthead", () => {
  it("renders title, registry, and tiles", () => {
    render(
      <ReferendumMasthead
        countryId="UK"
        emblemCountry="UK"
        registry="Referendums"
        title="United Kingdom"
        subtitle="1 live · 2 concluded"
        tiles={[
          { label: "Live campaigns", value: "1" },
          { label: "Concluded", value: "2" },
        ]}
      />
    );
    expect(screen.getByText("United Kingdom")).toBeTruthy();
    expect(screen.getByText("Referendums")).toBeTruthy();
    expect(screen.getByText("Live campaigns")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("renders a status pill and controls slot when provided", () => {
    render(
      <ReferendumMasthead
        countryId="UK"
        emblemCountry="UK"
        registry="UK · Northern Ireland"
        title="Northern Ireland"
        statusPill="campaigning"
        tiles={[{ label: "Yes", value: "57%", tone: "yes" }]}
        controls={<button>preview</button>}
      />
    );
    expect(screen.getByText("Live")).toBeTruthy();
    expect(screen.getByRole("button", { name: "preview" })).toBeTruthy();
  });

  it("renders a diagonal split-flag emblem when emblemSplit is given", () => {
    const { container } = render(
      <ReferendumMasthead
        countryId="UK"
        emblemCountry="UK"
        registry="UK · NIR"
        title="Northern Ireland"
        emblemSplit={{ topLeft: "IE", bottomRight: "UK" }}
        tiles={[{ label: "Reunify", value: "49%" }]}
      />
    );
    const tl = container.querySelector('[data-ref="emblem-tl"]');
    const br = container.querySelector('[data-ref="emblem-br"]');
    expect(tl?.getAttribute("style")).toContain("/api/flags/country/IE");
    expect(br?.getAttribute("style")).toContain("/api/flags/country/UK");
  });

  it("renders the kind-aware seal, watermark, and viewing-as slot", () => {
    render(
      <ReferendumMasthead
        countryId="UK"
        emblemCountry="UK"
        registry="UK · NIR"
        title="Northern Ireland"
        accent="yes"
        emblemSeal={{ line1: "NORTHERN IRELAND", line2: "BORDER POLL" }}
        watermark="NIR"
        viewingAs={<button type="button">Viewing as PM</button>}
        tiles={[{ label: "Reunify", value: "49%" }]}
      />
    );
    expect(screen.getByText("BORDER POLL")).toBeTruthy();
    expect(screen.getByText("NIR")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Viewing as PM/i })).toBeTruthy();
  });
});

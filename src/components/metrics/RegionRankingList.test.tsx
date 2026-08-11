/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RegionRankingList } from "./RegionRankingList";
import { catIcon } from "./catIcon";

const ranked = [
  { regionId: "CA", regionName: "California", value: 8064627, rank: 1 },
  { regionId: "TX", regionName: "Texas", value: 5000000, rank: 2 },
  { regionId: "NY", regionName: "New York", value: 1000000, rank: 3 },
];

describe("RegionRankingList", () => {
  it("renders every region with rank and full (untruncated) value", () => {
    render(
      <RegionRankingList
        ranked={ranked}
        scoreOf={() => 60}
        fmt={(v) => `$${v.toLocaleString("en-US")}`}
      />
    );
    expect(screen.getByText("California")).toBeTruthy();
    expect(screen.getByText("New York")).toBeTruthy();
    expect(screen.getByText("$8,064,627")).toBeTruthy();
    expect(screen.getByText("#1")).toBeTruthy();
    expect(screen.getByText("#3")).toBeTruthy();
  });

  it("strips a ' · ' suffix from region names", () => {
    render(
      <RegionRankingList
        ranked={[{ regionId: "HD", regionName: "Huadong · Shanghai", value: 50, rank: 1 }]}
        scoreOf={() => 60}
        fmt={(v) => String(v)}
      />
    );
    expect(screen.getByText("Huadong")).toBeTruthy();
  });
});

describe("catIcon", () => {
  it("returns an svg element for a known category", () => {
    const { container } = render(<>{catIcon("currency")}</>);
    expect(container.querySelector("svg")).toBeTruthy();
  });
});

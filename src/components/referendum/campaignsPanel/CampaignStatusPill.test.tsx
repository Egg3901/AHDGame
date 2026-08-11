/** @vitest-environment happy-dom */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { statusMeta, CampaignStatusPill } from "./CampaignStatusPill";

describe("CampaignStatusPill", () => {
  it("maps statuses to label + tone", () => {
    expect(statusMeta("campaigning")).toEqual({ label: "Live", tone: "amber" });
    expect(statusMeta("completed")).toEqual({ label: "Passed", tone: "yes" });
    expect(statusMeta("settled")).toEqual({ label: "Failed", tone: "no" });
  });
  it("renders the label", () => {
    render(<CampaignStatusPill status="campaigning" />);
    expect(screen.getByText("Live")).toBeTruthy();
  });
});

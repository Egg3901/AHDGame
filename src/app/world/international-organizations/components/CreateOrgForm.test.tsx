/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { CreateOrgForm } from "./CreateOrgForm";
import type { OrgViewerInfo } from "../orgTypes";

beforeEach(() =>
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, organizationId: "eap" }) })
  )
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const viewer = { foreignMinisterOf: "DE", headOfGovernmentOf: null } as unknown as OrgViewerInfo;

describe("CreateOrgForm", () => {
  it("opens and shows the name + short-name fields", () => {
    render(<CreateOrgForm viewer={viewer} onCreated={() => {}} />);
    fireEvent.click(screen.getByText("Found new organization"));
    expect(screen.getByText("Full name")).toBeTruthy();
    expect(screen.getByText("Short name")).toBeTruthy();
    expect(screen.getByText(/Up to 5 characters/)).toBeTruthy();
    expect(screen.getByText("Logo (optional)")).toBeTruthy();
  });

  it("hides the create button for a viewer with no diplomatic role", () => {
    render(<CreateOrgForm viewer={null} onCreated={() => {}} />);
    expect(screen.queryByText("Found new organization")).toBeNull();
  });

  it("rejects a reserved built-in short name with the full catalogue in the error", () => {
    render(<CreateOrgForm viewer={viewer} onCreated={() => {}} />);
    fireEvent.click(screen.getByText("Found new organization"));
    fireEvent.change(screen.getByLabelText(/Short name/), { target: { value: "NATO" } });
    fireEvent.change(screen.getByLabelText(/Full name/), {
      target: { value: "North Atlantic Treaty Organization" },
    });
    fireEvent.click(screen.getByText("Found organization"));
    expect(
      screen.getByText(
        /not match a built-in org \(EU, NATO, UN, Commonwealth, Warsaw Pact, Non-Aligned, COMECON\)/
      )
    ).toBeTruthy();
  });
});

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ProfileTabs } from "./ProfileTabs";

const subject = { id: "char-1", name: "Jane Doe" };

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

describe("ProfileTabs", () => {
  it("renders only the political content when Conflicts is disabled (no tabs)", () => {
    render(
      <ProfileTabs
        conflictsEnabled={false}
        subject={subject}
        adopted={{}}
        general={null}
        editable={true}
        curEra={2020}
      >
        <div>POLITICAL CONTENT</div>
      </ProfileTabs>
    );
    expect(screen.getByText("POLITICAL CONTENT")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Military" })).toBeNull();
  });

  it("shows Political + Military tabs when Conflicts is enabled", () => {
    render(
      <ProfileTabs
        conflictsEnabled
        subject={subject}
        adopted={{}}
        general={null}
        editable={true}
        curEra={2020}
      >
        <div>POLITICAL CONTENT</div>
      </ProfileTabs>
    );
    expect(screen.getByRole("tab", { name: "Political" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Military" })).toBeTruthy();
    // political is default
    expect(screen.getByText("POLITICAL CONTENT")).toBeTruthy();
  });

  it("switches to the Military tab (per-character General Profile)", () => {
    render(
      <ProfileTabs
        conflictsEnabled
        subject={subject}
        adopted={{}}
        general={null}
        editable={true}
        curEra={2020}
      >
        <div>POLITICAL CONTENT</div>
      </ProfileTabs>
    );
    fireEvent.click(screen.getByRole("tab", { name: "Military" }));
    // political content hidden; general profile (uncommissioned) shown
    expect(screen.queryByText("POLITICAL CONTENT")).toBeNull();
    // Uncommissioned: the Military tab renders, but offers no way in.
    expect(screen.queryByText("CHOOSE A SPECIALIZATION")).toBeNull();
    expect(screen.getByText(/not been commissioned as a general/i)).toBeTruthy();
  });
});

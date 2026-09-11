// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import PrivateNotListedNotice from "./PrivateNotListedNotice";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("PrivateNotListedNotice", () => {
  it("explains why the corp is absent from the market and dismisses per corp", async () => {
    render(<PrivateNotListedNotice corporationId="corp-1" corporationName="Bank of America" />);
    await screen.findByText("Not listed on any exchange");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss not-listed notice" }));
    expect(screen.queryByText("Not listed on any exchange")).toBeNull();
    expect(window.localStorage.getItem("ahd-private-not-listed-v1:corp-1")).toBe("1");
  });

  it("stays dismissed on revisit but never hides a different corporation", async () => {
    window.localStorage.setItem("ahd-private-not-listed-v1:corp-1", "1");
    render(<PrivateNotListedNotice corporationId="corp-1" corporationName="Bank of America" />);
    // Dismissal reads after mount, so the first paint still shows the notice.
    await waitFor(() => expect(screen.queryByText("Not listed on any exchange")).toBeNull());
    cleanup();

    render(<PrivateNotListedNotice corporationId="corp-2" corporationName="Other Corp" />);
    await screen.findByText("Not listed on any exchange");
  });
});

/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EndorseControl } from "./EndorseControl";

function renderControl(over: Partial<React.ComponentProps<typeof EndorseControl>> = {}) {
  const onChanged = vi.fn();
  render(
    <EndorseControl
      electionId="e1"
      candidateId="c1"
      myCharId="me"
      isYou={false}
      endorsed={false}
      onChanged={onChanged}
      {...over}
    />
  );
  return onChanged;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});

describe("EndorseControl", () => {
  it("renders nothing for a candidate the viewer cannot endorse", () => {
    renderControl({ eligible: false });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps an existing endorsement undoable even if no longer eligible", () => {
    renderControl({ eligible: false, endorsed: true });
    expect(screen.getByRole("button", { name: "Endorsed" })).toBeTruthy();
  });

  it("renders nothing without a character", () => {
    renderControl({ myCharId: null });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders nothing on the reader's own candidacy", () => {
    renderControl({ isYou: true });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("POSTs the candidate and reports the new endorsement", async () => {
    const onChanged = renderControl();
    fireEvent.click(screen.getByRole("button", { name: "Endorse" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith("c1"));
    expect(fetch).toHaveBeenCalledWith(
      "/api/elections/e1/endorse",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ candidateId: "c1" }) })
    );
  });

  it("DELETEs when already endorsed and reports none", async () => {
    const onChanged = renderControl({ endorsed: true });
    fireEvent.click(screen.getByRole("button", { name: "Endorsed" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(null));
    expect(fetch).toHaveBeenCalledWith(
      "/api/elections/e1/endorse",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("shows the route's reason when it refuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: "This election has ended" }),
      })
    );
    const onChanged = renderControl();
    fireEvent.click(screen.getByRole("button", { name: "Endorse" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(onChanged).not.toHaveBeenCalled();
  });
});

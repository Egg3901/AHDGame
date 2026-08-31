/** @vitest-environment happy-dom */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { BillVoteIndicator } from "./BillVoteIndicator";

const preview = {
  current: { economic: 1, social: 0 },
  aye: { economic: -0.25, social: 0 },
  nay: { economic: 0.25, social: 0 },
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BillVoteIndicator shift preview", () => {
  it("shows the preview above the buttons for a voter who has not voted", () => {
    render(<BillVoteIndicator billId="b1" myVote={null} canVote shiftPreview={preview} />);
    expect(screen.getByText("Aye:")).toBeTruthy();
    expect(screen.getByText("Nay:")).toBeTruthy();
  });

  it("hides the preview once a vote is cast locally until the server sends fresh numbers", async () => {
    render(<BillVoteIndicator billId="b1" myVote={null} canVote shiftPreview={preview} />);
    fireEvent.click(screen.getByRole("button", { name: "Aye" }));
    await waitFor(() => expect(screen.getByText(/Voted For/)).toBeTruthy());
    // The numbers on screen were computed before the vote; showing them now would
    // promise a second step. They come back when the parent refetches and passes
    // a matching myVote.
    expect(screen.queryByText("Aye:")).toBeNull();
  });

  it("shows the preview again once the server-side vote matches the local one", () => {
    render(<BillVoteIndicator billId="b1" myVote="for" canVote shiftPreview={preview} />);
    expect(screen.getByText("Aye:")).toBeTruthy();
  });
});

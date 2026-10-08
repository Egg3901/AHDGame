/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PARTY_SWITCH_ELECTION_WARNING } from "@/components/party/PartySwitchElectionWarning";
import { CharterActions } from "./CharterActions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(cleanup);

describe("CharterActions party switch warning", () => {
  it("warns a founder who already belongs to a party", () => {
    render(
      <CharterActions
        charterId="507f1f77bcf86cd799439011"
        alreadySigned={false}
        alreadyRejected={false}
        showPartySwitchWarning
      />
    );

    expect(screen.getByRole("note").textContent).toBe(PARTY_SWITCH_ELECTION_WARNING);
  });

  it("does not warn an Independent founder", () => {
    render(
      <CharterActions
        charterId="507f1f77bcf86cd799439011"
        alreadySigned={false}
        alreadyRejected={false}
      />
    );

    expect(screen.queryByRole("note")).toBeNull();
  });
});

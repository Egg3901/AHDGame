/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ResultsViewRouter } from "./ResultsViewRouter";
import { nightFixture, settledFixture } from "../../night/nightTestData";

vi.mock("../../night/NightBroadcast", () => ({
  NightBroadcast: () => <div data-testid="broadcast" />,
}));
vi.mock("./PresidentialResultsView", () => ({
  PresidentialResultsView: () => <div data-testid="normal-president" />,
}));
vi.mock("./ParliamentaryResultsView", () => ({ ParliamentaryResultsView: () => null }));
vi.mock("./SingleWinnerResultsView", () => ({ SingleWinnerResultsView: () => null }));

afterEach(cleanup);

describe("ResultsViewRouter election night switchover", () => {
  it("shows the broadcast for a US president race while the night is present", () => {
    render(<ResultsViewRouter data={nightFixture()} />);
    expect(screen.getByTestId("broadcast")).toBeTruthy();
    expect(screen.queryByTestId("normal-president")).toBeNull();
  });

  it("shows the normal presidential results when no night is present", () => {
    render(<ResultsViewRouter data={settledFixture()} />);
    expect(screen.getByTestId("normal-president")).toBeTruthy();
    expect(screen.queryByTestId("broadcast")).toBeNull();
  });

  it("leaves non-US presidential races on the normal view", () => {
    const data = nightFixture();
    data.election.countryId = "UK";
    render(<ResultsViewRouter data={data} />);
    expect(screen.getByTestId("normal-president")).toBeTruthy();
  });
});

/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UnionFundTreasuryPanel } from "./UnionFundTreasuryPanel";

afterEach(() => vi.restoreAllMocks());

function panel(overrides: Partial<React.ComponentProps<typeof UnionFundTreasuryPanel>> = {}) {
  return (
    <UnionFundTreasuryPanel
      unionId="u1"
      countryId="US"
      treasury={250}
      isHead
      suspended={false}
      onFunded={() => {}}
      {...overrides}
    />
  );
}

describe("UnionFundTreasuryPanel", () => {
  it("answers what the treasury is and where it comes from (ticket 1112)", () => {
    render(panel({ isHead: false }));

    expect(screen.getByText(/comes in from dues every turn/i)).toBeTruthy();
    expect(screen.getByText(/services, organizing drives and bargaining/i)).toBeTruthy();
  });

  it("lets the head send personal cash to the union (ticket 1121)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    global.fetch = fetchMock as unknown as typeof fetch;
    const onFunded = vi.fn();
    render(panel({ onFunded }));

    fireEvent.change(screen.getByLabelText(/contribute from campaign funds/i), {
      target: { value: "5000" },
    });
    fireEvent.click(screen.getByRole("button", { name: /fund treasury/i }));

    await waitFor(() => expect(onFunded).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/unions/u1/fund");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ amount: 5000 });
  });

  it("shows no contribution control to someone who does not lead the union", () => {
    render(panel({ isHead: false }));

    expect(screen.queryByRole("button", { name: /fund treasury/i })).toBeNull();
    expect(screen.queryByLabelText(/contribute from campaign funds/i)).toBeNull();
  });

  it("keeps the button disabled until the amount is a usable number", () => {
    render(panel());

    const button = screen.getByRole("button", { name: /fund treasury/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/contribute from campaign funds/i), {
      target: { value: "0" },
    });
    expect(button.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/contribute from campaign funds/i), {
      target: { value: "10" },
    });
    expect(button.disabled).toBe(false);
  });

  it("disables funding while the union is suspended under a ban", () => {
    render(panel({ suspended: true }));

    expect(
      (screen.getByRole("button", { name: /fund treasury/i }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it("surfaces the server error and states that nothing was spent on a network failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
    render(panel());

    fireEvent.change(screen.getByLabelText(/contribute from campaign funds/i), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: /fund treasury/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toMatch(/nothing was spent/i);
  });
});

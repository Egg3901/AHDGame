// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { DeclareWarPanel } from "./DeclareWarPanel";

// The picker reads runtime-enabled countries; pin the list so the test does not
// depend on which countries an admin has switched on.
vi.mock("@/lib/hooks/useEnabledCountryIds", () => ({
  useEnabledCountryIds: () => ["US", "CN", "UK"],
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const props = { countryCode: "us", countryId: "US" as const, canAct: true };

describe("DeclareWarPanel", () => {
  it("says plainly that filing does not start the war", () => {
    render(<DeclareWarPanel {...props} />);
    expect(screen.getByText(/does not begin a war on its own/i)).toBeTruthy();
    expect(screen.getByText(/two-thirds supermajority of votes cast/i)).toBeTruthy();
  });

  it("offers conquest but does not let it be chosen", () => {
    // The UI half of the reservation. The server refuses it as well.
    render(<DeclareWarPanel {...props} />);
    const conquest = screen.getByRole("option", { name: /Conquest/ }) as HTMLOptionElement;
    expect(conquest.disabled).toBe(true);
    const punitive = screen.getByRole("option", { name: /^Punitive$/ }) as HTMLOptionElement;
    expect(punitive.disabled).toBe(false);
  });

  it("never offers your own country as a target", () => {
    render(<DeclareWarPanel {...props} />);
    expect(screen.queryByRole("option", { name: "United States" })).toBeNull();
  });

  it("offers only countries that are open to players", () => {
    // COUNTRY_ORDER would also have listed sub-national entities and countries an
    // admin has not switched on.
    render(<DeclareWarPanel {...props} />);
    expect(screen.getByRole("option", { name: /China/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Scotland|Wales|Belarus/ })).toBeNull();
  });

  it("states the cooldown so it is not discovered by being refused", () => {
    render(<DeclareWarPanel {...props} />);
    expect(screen.getByText(/once every 120 turns/i)).toBeTruthy();
  });

  it("files the declaration and reports what happens next", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<DeclareWarPanel {...props} />);

    fireEvent.change(screen.getByLabelText(/target country/i), { target: { value: "CN" } });
    fireEvent.change(screen.getByLabelText(/war goal/i), { target: { value: "punitive" } });
    fireEvent.click(screen.getByRole("button", { name: /file declaration/i }));

    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/country/us/executive/declare-war",
      expect.objectContaining({ method: "POST" })
    );
    expect(screen.getByText(/two-thirds supermajority before the war begins/i)).toBeTruthy();
  });

  it("surfaces the server's refusal instead of failing silently", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "You are already at war with that country." }),
      })
    );
    render(<DeclareWarPanel {...props} />);
    fireEvent.change(screen.getByLabelText(/target country/i), { target: { value: "CN" } });
    fireEvent.change(screen.getByLabelText(/war goal/i), { target: { value: "punitive" } });
    fireEvent.click(screen.getByRole("button", { name: /file declaration/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/already at war/i);
  });

  it("cannot be submitted until both a target and a goal are chosen", () => {
    render(<DeclareWarPanel {...props} />);
    const button = screen.getByRole("button", { name: /file declaration/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/target country/i), { target: { value: "CN" } });
    expect(button.disabled).toBe(true);
  });

  it("is read-only for someone who does not hold the seat", () => {
    render(<DeclareWarPanel {...props} canAct={false} />);
    expect(screen.getByText(/read-only/i)).toBeTruthy();
    expect((screen.getByLabelText(/target country/i) as HTMLSelectElement).disabled).toBe(true);
  });
});

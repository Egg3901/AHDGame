/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../messages/en/nav.json";
import { WestminsterDevolutionTab } from "./WestminsterDevolutionTab";
import { computeIndependenceDesireDriftSnapshot } from "@/lib/governorOffice/devolution/rules";
const makeData = (canManage = true) => ({
  currentTurn: 100,
  actions: 2,
  canManage,
  stances: { SCO: { policy: "independence", changedAtTurn: 99 } },
  regions: ["WAL", "SCO", "NIR"].map((stateId) => {
    const inputs = { regionalApproval: 70, nationalApproval: 60, inflationPercent: 3 };
    const policy = stateId === "WAL" ? ("pro" as const) : ("independence" as const);
    const westminsterPolicy = stateId === "NIR" ? ("independence" as const) : ("anti" as const);
    return {
      stateId,
      previous: stateId === "WAL" ? 10 : 35,
      trend: 0.004,
      policy,
      westminsterPolicy,
      inputs,
      ...computeIndependenceDesireDriftSnapshot({
        previous: 35,
        policy,
        westminsterPolicy,
        ...inputs,
      }),
    };
  }),
});
function show() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <WestminsterDevolutionTab />
    </NextIntlClientProvider>
  );
}
function response(data: unknown) {
  return Promise.resolve(new Response(JSON.stringify(data), { status: 200 }));
}
describe("Westminster regional dashboard", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => response(makeData()))
    );
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it("shows one nation's Desire at a time, with both stances and drivers", async () => {
    show();
    await screen.findByText("10.00");
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    fireEvent.click(screen.getByRole("tab", { name: "Northern Ireland" }));
    expect(screen.getByText("Reunification Desire")).toBeTruthy();
    expect(screen.queryByText("10.00")).toBeNull();
    expect(screen.getAllByText("Irish Reunification").length).toBeGreaterThan(0);
    expect(screen.getByText("Westminster policy")).toBeTruthy();
    expect(screen.getByText("First Minister policy")).toBeTruthy();
  });
  it("supports keyboard navigation between region tabs", async () => {
    show();
    await screen.findByText("10.00");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Wales" }), { key: "End" });
    expect(
      screen.getByRole("tab", { name: "Northern Ireland" }).getAttribute("aria-selected")
    ).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Northern Ireland" }));
  });
  it("sends only the selected region and reloads the shared AP balance", async () => {
    show();
    await screen.findByText("10.00");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "pro" } });
    fireEvent.click(screen.getByRole("button", { name: "Change Westminster stance" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(vi.mocked(fetch).mock.calls[1][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ stateId: "WAL", policy: "pro" }),
    });
  });
  it("disables a region on its own cooldown", async () => {
    show();
    await screen.findByText("10.00");
    fireEvent.click(screen.getByRole("tab", { name: "Scotland" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "pro" } });
    expect(screen.getByText("Available again in 71 turns.")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Change Westminster stance" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });
  it("shows public tracking without policy controls to a non-PM", async () => {
    vi.mocked(fetch).mockImplementation(() => response(makeData(false)));
    show();
    await screen.findByText("10.00");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(within(screen.getByRole("tabpanel")).getByText("Westminster policy")).toBeTruthy();
  });
  it("keeps a failed write visible and offers retry", async () => {
    vi.mocked(fetch)
      .mockImplementationOnce(() => response(makeData()))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Office policy or action points changed." }), {
          status: 409,
        })
      );
    show();
    await screen.findByText("10.00");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "pro" } });
    fireEvent.click(screen.getByRole("button", { name: "Change Westminster stance" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Office policy or action points changed."
    );
  });
  it("shows the incoming government's allowance and permits an inherited cooldown change", async () => {
    vi.mocked(fetch).mockImplementation(() =>
      response({ ...makeData(), government: { key: "incoming", formedTurn: 100 } })
    );
    show();
    await screen.findByText("10.00");
    expect(screen.getByText(/Projected movement over one game year/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Scotland" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "pro" } });
    expect(screen.getByText(/Incoming government: your first change/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Change Westminster stance" }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });
});

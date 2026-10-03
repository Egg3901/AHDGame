// @vitest-environment happy-dom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "@/../messages/en/elections.json";
import { HuListVacanciesCard } from "./HuListVacanciesCard";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const vacancy = {
  receiptId: "HU:mixed1989:1",
  slotPersonId: "departed",
  partyId: "1",
  tier: "territorial",
  districtId: "county",
  candidates: [
    { personId: "first", name: "Filed first", isNpc: true },
    { personId: "chosen", name: "Filed choice", isNpc: false },
  ],
};
function show(onUpdate = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
      <HuListVacanciesCard partyId="1" onUpdate={onUpdate} />
    </NextIntlClientProvider>
  );
}
describe("Hungarian chair list designation", () => {
  it("shows only this party's filed candidates and posts the chair's chosen person", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            vacancies: [vacancy, { ...vacancy, slotPersonId: "other-party", partyId: "2" }],
          })
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ vacancies: [] })));
    vi.stubGlobal("fetch", fetcher);
    const onUpdate = vi.fn();
    show(onUpdate);
    const selector = await screen.findByRole("combobox");
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    const button = screen.getByRole("button", { name: "Designate deputy" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(selector, { target: { value: "chosen" } });
    fireEvent.click(button);
    await screen.findByText("Replacement deputy seated.");
    const options = fetcher.mock.calls.find(([, options]) => options?.method === "POST")![1];
    expect(JSON.parse(options.body)).toEqual({
      receiptId: vacancy.receiptId,
      slotPersonId: "departed",
      personId: "chosen",
    });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("combobox")).toBeNull();
  });
  it("keeps a rejected choice visible and reports the current conflict", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ vacancies: [vacancy] })))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: "This list vacancy is no longer available" }), {
            status: 409,
          })
        )
    );
    show();
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "chosen" } });
    fireEvent.click(screen.getByRole("button", { name: "Designate deputy" }));
    await screen.findByText("This list vacancy is no longer available");
    await waitFor(() =>
      expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false)
    );
  });
  it("displays exhausted lists without inventing a selectable replacement", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ vacancies: [{ ...vacancy, candidates: [] }] }))
        )
    );
    show();
    await screen.findByText("No available nominee remains on this original list.");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

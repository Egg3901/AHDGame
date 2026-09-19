/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CoalitionIdentityForm } from "./CoalitionIdentityForm";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("submits the edited identity and refreshes the coalition", async () => {
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
  vi.stubGlobal("fetch", fetch);
  const onSaved = vi.fn();
  render(
    <CoalitionIdentityForm
      coalition={{ name: "Old Alliance", abbreviation: "OA", color: "#123456" }}
      endpoint="/api/country/uk/coalitions/1/settings"
      onSaved={onSaved}
    />
  );
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New Alliance" } });
  fireEvent.click(screen.getByRole("button", { name: "Save identity" }));
  await screen.findByText("Coalition identity updated.");
  expect(onSaved).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledWith(
    "/api/country/uk/coalitions/1/settings",
    expect.objectContaining({
      body: JSON.stringify({ name: "New Alliance", abbreviation: "OA", color: "#123456" }),
    })
  );
});
it("keeps edits visible after a rejected save", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, json: async () => ({ error: "Name already taken." }) }))
  );
  const onSaved = vi.fn();
  render(
    <CoalitionIdentityForm
      coalition={{ name: "New Alliance", abbreviation: "NA", color: "#123456" }}
      endpoint="/settings"
      onSaved={onSaved}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Save identity" }));
  await screen.findByText("Name already taken.");
  expect(onSaved).not.toHaveBeenCalled();
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("New Alliance");
});

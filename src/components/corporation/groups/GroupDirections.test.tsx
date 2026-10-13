/** @vitest-environment happy-dom */
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en/corporations.json";
import { GroupDirections } from "./GroupDirections";
import type { GroupManagementView } from "./useGroupManagement";
const direction = {
  revision: "rev",
  objective: "expansion",
  regions: ["r0"],
  allowInvestment: false,
  setTurn: 12,
  response: "pending",
};
const npp = {
  id: "npp",
  name: "Steelworks",
  operator: "npp",
  isRoot: false,
  canEdit: false,
  tickerSymbol: "STL",
  parentControl: { votingPercent: 90 },
  direction,
};
const player = {
  id: "player",
  name: "Logistics",
  operator: "player",
  isRoot: false,
  canEdit: false,
  direction: { ...direction, revision: "player-rev" },
};
const data = {
  canManage: true,
  supplyEngineEnabled: false,
  directionsEnabled: false,
  members: [{ id: "root", name: "Parent", isRoot: true }, npp, player],
  regions: Array.from({ length: 10 }, (_, i) => ({
    id: "r" + i,
    name: "Region " + i,
    countryId: "US",
  })),
} as unknown as GroupManagementView;
function mount(value = data, save = vi.fn().mockResolvedValue(true), busy = false) {
  render(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
      <GroupDirections data={value} save={save} busy={busy} />
    </NextIntlClientProvider>
  );
  return save;
}
afterEach(cleanup);
describe("Subsidiary direction", () => {
  it("shows saved configuration, regional chips, investment constraints and readable response status", () => {
    mount();
    expect(screen.getByText(/90.0% voting control/)).toBeTruthy();
    expect(screen.getAllByText("Region 0")).toHaveLength(2);
    expect(screen.getByText("Suggestion pending")).toBeTruthy();
    expect(screen.getByText("Direction saved")).toBeTruthy();
    expect(screen.getByText(/Investment is currently not authorized/)).toBeTruthy();
    expect(screen.queryByLabelText("Primary objective")).toBeNull();
    expect(screen.queryByRole("button", { name: "Acknowledge" })).toBeNull();
    expect(screen.getByText(/Subsidiary directions are unavailable/)).toBeTruthy();
  });
  it("keeps directions available when the separate Group Chain is off", () => {
    mount({ ...data, directionsEnabled: true, supplyEngineEnabled: false });
    expect(screen.queryByText(/Subsidiary directions are unavailable/)).toBeNull();
    expect(screen.getByRole("button", { name: "Edit direction" })).toBeTruthy();
  });
  it("edits objectives and searchable target regions, validates regional selection and saves existing command fields", async () => {
    const save = mount();
    fireEvent.click(screen.getByRole("button", { name: "Edit direction" }));
    const objective = screen.getByRole("combobox");
    fireEvent.change(objective, { target: { value: "regional" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "US: Region 0" }));
    fireEvent.click(screen.getByRole("button", { name: "Save objective" }));
    expect(screen.getByRole("alert").textContent).toContain("Select at least one");
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Region 9" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "US: Region 9" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Authorize viable capital investment" }));
    fireEvent.click(screen.getByRole("button", { name: "Save objective" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        action: "direction",
        memberId: "npp",
        objective: "regional",
        regions: ["r9"],
        allowInvestment: true,
      })
    );
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
  });
  it("enforces the eight-region limit while allowing deselection", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Edit direction" }));
    for (let i = 1; i < 8; i++)
      fireEvent.click(screen.getByRole("checkbox", { name: "US: Region " + i }));
    expect(
      (screen.getByRole("checkbox", { name: "US: Region 8" }) as HTMLInputElement).disabled
    ).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "US: Region 0" }));
    expect(
      (screen.getByRole("checkbox", { name: "US: Region 8" }) as HTMLInputElement).disabled
    ).toBe(false);
  });
  it("cancels unsaved changes and keeps a rejected save open", async () => {
    const save = mount(data, vi.fn().mockResolvedValue(false));
    fireEvent.click(screen.getByRole("button", { name: "Edit direction" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "profit" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Edit direction" }));
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("expansion");
    fireEvent.click(screen.getByRole("button", { name: "Save objective" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Unable to save"));
    expect(screen.getByRole("combobox")).toBeTruthy();
  });
  it("shows only the player's own suggestion and uses its revision for voluntary responses", () => {
    const save = mount({
      ...data,
      canManage: false,
      members: [npp, { ...player, canEdit: true }],
    } as unknown as GroupManagementView);
    expect(screen.queryByText("Steelworks")).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit suggestion" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    expect(save).toHaveBeenCalledWith(
      { action: "respond", response: "acknowledged", revision: "player-rev" },
      "player"
    );
  });
  it("keeps player suggestions separate from automatic investment and handles empty access", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Edit suggestion" }));
    expect(
      screen.queryByRole("checkbox", { name: "Authorize viable capital investment" })
    ).toBeNull();
    expect(screen.getByText(/Acknowledging it does not commit output/)).toBeTruthy();
    cleanup();
    mount({ ...data, canManage: false, members: [] } as unknown as GroupManagementView);
    expect(screen.getByText(/There are no subsidiary directions/)).toBeTruthy();
  });
  it("disables response and editing while saving and labels acknowledged/declined responses", () => {
    mount(
      {
        ...data,
        members: [
          { ...player, canEdit: true, direction: { ...direction, response: "acknowledged" } },
        ],
      } as unknown as GroupManagementView,
      vi.fn(),
      true
    );
    expect(screen.getByText("Suggestion acknowledged")).toBeTruthy();
    for (const b of screen.getAllByRole("button"))
      expect((b as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    mount({
      ...data,
      members: [{ ...player, direction: { ...direction, response: "declined" } }],
    } as unknown as GroupManagementView);
    expect(screen.getByText("Suggestion declined")).toBeTruthy();
  });
});

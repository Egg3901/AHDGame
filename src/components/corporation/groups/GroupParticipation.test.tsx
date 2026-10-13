/** @vitest-environment happy-dom */
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en/corporations.json";
import { GroupParticipation } from "./GroupParticipation";
import type { GroupManagementView } from "./useGroupManagement";
const member = {
  id: "member",
  pathId: "1",
  name: "Player corporation",
  operator: "player",
  isRoot: false,
  canEdit: true,
  receiving: false,
  requested: false,
  effectiveTurn: null,
  direction: null,
};
function show(policy: "independent" | "members", office = false, canEdit = true) {
  const changed = vi.fn();
  const data = { settings: { supplyPolicy: policy }, currentTurn: 20 } as GroupManagementView;
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <GroupParticipation
        data={data}
        member={{ ...member, canEdit } as GroupManagementView["members"][number]}
        busy={false}
        office={office}
        onChange={changed}
      />
    </NextIntlClientProvider>
  );
  return changed;
}
afterEach(cleanup);
describe("group receiving control", () => {
  it("hides on the group under independence", () => {
    show("independent");
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
  it("is disabled with explanatory copy in CEO Office under independence", () => {
    show("independent", true);
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/Participation is unavailable/)).toBeTruthy();
  });
  it("lets the operating player change their receiving preference", () => {
    const change = show("members");
    fireEvent.click(screen.getByRole("checkbox"));
    expect(change).toHaveBeenCalledWith(true);
  });
  it("does not let the parent override another player", () => {
    show("members", false, false);
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/Only this corporation/)).toBeTruthy();
  });
});

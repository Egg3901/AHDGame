/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en/elections.json";
import { makeCharacter } from "@/lib/test-utils/factories";
import { CampaignActionModal } from "./CampaignActionModal";

vi.mock("@/app/campaign/[id]/components/TargetedAdsPanel", () => ({
  TargetedAdsPanel: () => <div>Ad controls</div>,
}));
vi.mock("@/app/campaign/[id]/components/CanvassingPanel", () => ({
  CanvassingPanel: () => <div>Canvassing controls</div>,
}));
afterEach(cleanup);

it.each(["targetedAds", "canvass"] as const)(
  "opens %s in an accessible dismissible window",
  (action) => {
    const close = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <CampaignActionModal
          action={action}
          character={makeCharacter()}
          onClose={close}
          onResourcesSpent={vi.fn()}
        />
      </NextIntlClientProvider>
    );
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
    expect(
      screen.getByText(action === "canvass" ? "Canvassing controls" : "Ad controls")
    ).toBeDefined();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
  }
);

it("does not mount an action until opened", () => {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CampaignActionModal
        action={null}
        character={makeCharacter()}
        onClose={vi.fn()}
        onResourcesSpent={vi.fn()}
      />
    </NextIntlClientProvider>
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("Ad controls")).toBeNull();
});

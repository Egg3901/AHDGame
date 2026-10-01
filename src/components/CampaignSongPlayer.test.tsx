// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableIframePageLoading":true,"handleDisabledFileLoadingAsSuccess":true}}
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/image", () => ({
  default: (props: { alt: string }) => <span data-alt={props.alt} />,
}));

import { CampaignSongPlayer } from "./CampaignSongPlayer";

describe("CampaignSongPlayer", () => {
  it("loads nothing from YouTube until the viewer presses play", () => {
    const { container } = render(<CampaignSongPlayer videoId="dQw4w9WgXcQ" characterName="Ada" />);
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.firstElementChild?.className).toContain("store-app-hidden");
    expect(screen.getByText("Ada's Campaign Song")).toBeTruthy();
  });

  it("mounts YouTube's own visible player on press and removes it on close", () => {
    const { container } = render(
      <CampaignSongPlayer videoId="dQw4w9WgXcQ" characterName="Ada" label="Royal Anthem" />
    );
    fireEvent.click(screen.getByRole("button", { name: "Play Royal Anthem" }));
    const frame = container.querySelector("iframe");
    expect(frame?.getAttribute("src")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&playsinline=1"
    );
    expect(frame?.parentElement?.className).toContain("min-h-[200px]");
    fireEvent.click(screen.getByRole("button", { name: "Close Royal Anthem" }));
    expect(container.querySelector("iframe")).toBeNull();
  });
});

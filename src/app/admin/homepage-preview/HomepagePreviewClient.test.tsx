/**
 * @vitest-environment happy-dom
 *
 * The admin preview opens on the live world's era and can switch to any other
 * seed's landing, with that seed's roster and a day-after-reset player count.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { fireEvent, render } from "@testing-library/react";
import { fallbackMarketedWorld } from "@/lib/marketing/marketedWorld";

const landingProps: Record<string, unknown>[] = [];
vi.mock("@/app/_landing-v2/SandboxHome", () => ({
  SandboxHome: (props: Record<string, unknown>) => {
    landingProps.push(props);
    return <div data-testid="landing" />;
  },
}));

beforeEach(() => {
  landingProps.length = 0;
});

async function renderPreview() {
  const { HomepagePreviewClient } = await import("./HomepagePreviewClient");
  const live = { ...fallbackMarketedWorld(1953), version: "9.9.9" };
  const view = render(<HomepagePreviewClient world={live} />);
  return { ...view, live };
}

const latest = () => landingProps[landingProps.length - 1];

describe("HomepagePreviewClient era picker", () => {
  it("opens on the live world, with its own world data and live counts", async () => {
    const { live } = await renderPreview();
    expect(latest().era).toBe("1953");
    expect(latest().world).toBe(live);
    expect(latest().playerCounts).toBeUndefined();
  });

  it("previews another seed with that seed's roster and zero players", async () => {
    const { getByLabelText } = await renderPreview();
    fireEvent.change(getByLabelText("Preview era"), { target: { value: "1991" } });
    const props = latest();
    expect(props.era).toBe("1991");
    const world = props.world as ReturnType<typeof fallbackMarketedWorld>;
    expect(world.seedYear).toBe(1991);
    expect(world.version).toBe("9.9.9");
    expect(props.playerCounts).toEqual({ US: 0, UK: 0, JP: 0 });
  });
});

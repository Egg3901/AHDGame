/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { PollBannerTab } from "./PollBannerTab";

const SAVED = {
  enabled: false,
  message: "Please fill out the survey here for feedback about the game:",
  linkLabel: "Click Here",
  url: "https://forms.gle/abc123",
  tone: "info",
  updatedBy: "admin1",
  updatedAt: "2026-08-30T12:00:00.000Z",
};

/** Answers the panel's GET with `SAVED` and records every PATCH body. */
function stubApi() {
  const patches: unknown[] = [];
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      patches.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    return new Response(JSON.stringify(SAVED), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { patches, fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PollBannerTab", () => {
  it("loads the saved draft into the form", async () => {
    stubApi();
    render(<PollBannerTab />);

    await waitFor(() =>
      expect((screen.getByLabelText(/Message/i) as HTMLInputElement).value).toBe(SAVED.message)
    );
    expect((screen.getByLabelText(/Link URL/i) as HTMLInputElement).value).toBe(SAVED.url);
    expect((screen.getByLabelText(/Link text/i) as HTMLInputElement).value).toBe(SAVED.linkLabel);
  });

  it("sends the edited fields to the admin endpoint on save", async () => {
    const { patches } = stubApi();
    render(<PollBannerTab />);

    await waitFor(() => screen.getByLabelText(/Message/i));

    fireEvent.change(screen.getByLabelText(/Message/i), {
      target: { value: "Take the player survey:" },
    });
    fireEvent.click(screen.getByLabelText(/Show this banner/i));
    fireEvent.click(screen.getByRole("button", { name: /Save/i }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toMatchObject({
      enabled: true,
      message: "Take the player survey:",
      url: SAVED.url,
    });
  });

  it("previews the strip as players will see it, even while it is switched off", async () => {
    stubApi();
    render(<PollBannerTab />);

    await waitFor(() => screen.getByLabelText(/Message/i));

    const preview = screen.getByRole("link", { name: "Click Here" });
    expect(preview.getAttribute("href")).toBe(SAVED.url);
  });

  it("updates the preview as the admin types", async () => {
    stubApi();
    render(<PollBannerTab />);

    await waitFor(() => screen.getByLabelText(/Message/i));

    fireEvent.change(screen.getByLabelText(/Link text/i), { target: { value: "Take it here" } });

    await waitFor(() => expect(screen.getByRole("link", { name: "Take it here" })).toBeTruthy());
  });

  it("refuses to enable a banner with an unsafe link and never calls the api", async () => {
    const { patches } = stubApi();
    render(<PollBannerTab />);

    await waitFor(() => screen.getByLabelText(/Message/i));

    fireEvent.change(screen.getByLabelText(/Link URL/i), {
      target: { value: "javascript:alert(1)" },
    });
    fireEvent.click(screen.getByLabelText(/Show this banner/i));
    fireEvent.click(screen.getByRole("button", { name: /Save/i }));

    await waitFor(() => expect(screen.getByText(/Fix the highlighted link/i)).toBeTruthy());
    // The field itself still carries the explanation of what a valid link is.
    expect(screen.getByText(/absolute http/i)).toBeTruthy();
    expect(patches).toHaveLength(0);
  });

  it("names the admin who last saved the banner", async () => {
    stubApi();
    render(<PollBannerTab />);

    await waitFor(() => expect(screen.getByText(/admin1/)).toBeTruthy());
  });
});

describe("PollBannerTab when the current banner cannot be loaded", () => {
  it("says so and refuses to save, rather than showing a blank form", async () => {
    const patches: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          patches.push(JSON.parse(String(init.body)));
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        return new Response("boom", { status: 500 });
      })
    );

    render(<PollBannerTab />);

    // Without this the admin sees an empty form that reads as "nothing is
    // configured", and saving it would wipe the real banner.
    await waitFor(() => expect(screen.getByText(/could not load/i)).toBeTruthy());

    const save = screen.getByRole("button", { name: /Save/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.click(save);
    expect(patches).toHaveLength(0);
  });

  it("does not report failure when the save worked but the refresh afterwards did not", async () => {
    let gets = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        gets += 1;
        // First load succeeds; the refresh after saving does not.
        return gets === 1
          ? new Response(JSON.stringify(SAVED), { status: 200 })
          : new Response("boom", { status: 500 });
      })
    );

    render(<PollBannerTab />);
    await waitFor(() => screen.getByLabelText(/Message/i));

    fireEvent.click(screen.getByRole("button", { name: /Save/i }));

    await waitFor(() => expect(screen.getByText(/^Saved\.$/)).toBeTruthy());
    expect(screen.queryByText(/could not load/i)).toBeNull();
  });
});

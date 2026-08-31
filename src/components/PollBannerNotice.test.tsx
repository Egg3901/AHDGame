/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { PollBannerNotice, PollBannerStrip } from "./PollBannerNotice";
import type { PollBannerSnapshot } from "@/lib/pollBanner";

/** Drives the component's usePathname without inventing a fake module export. */
const mockPathname = vi.hoisted(() => ({ current: "/world" }));
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname.current,
}));

function setMockPathname(pathname: string) {
  mockPathname.current = pathname;
}

const ENABLED: PollBannerSnapshot = {
  enabled: true,
  message: "Please fill out the survey here for feedback about the game:",
  linkLabel: "Click Here",
  url: "https://forms.gle/abc123",
  tone: "info",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PollBannerStrip", () => {
  it("renders nothing when the banner is disabled", () => {
    const { container } = render(<PollBannerStrip snapshot={{ ...ENABLED, enabled: false }} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the admin's message", () => {
    render(<PollBannerStrip snapshot={ENABLED} />);
    expect(
      screen.getByText(/Please fill out the survey here for feedback about the game:/)
    ).toBeTruthy();
  });

  it("links the admin's label to the admin's url", () => {
    render(<PollBannerStrip snapshot={ENABLED} />);
    const link = screen.getByRole("link", { name: "Click Here" });
    expect(link.getAttribute("href")).toBe("https://forms.gle/abc123");
  });

  it("opens the survey in a new tab without handing it window.opener", () => {
    render(<PollBannerStrip snapshot={ENABLED} />);
    const link = screen.getByRole("link", { name: "Click Here" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  it("uses the info palette for a routine banner", () => {
    const { container } = render(<PollBannerStrip snapshot={ENABLED} />);
    expect((container.firstChild as HTMLElement).className).toContain("bg-info/10");
  });

  it("uses the warning palette for an urgent banner", () => {
    const { container } = render(<PollBannerStrip snapshot={{ ...ENABLED, tone: "warning" }} />);
    expect((container.firstChild as HTMLElement).className).toContain("bg-warning/10");
  });
});

describe("PollBannerNotice", () => {
  it("renders the strip once the public endpoint reports an enabled banner", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(ENABLED), { status: 200 }))
    );

    render(<PollBannerNotice />);

    await waitFor(() => expect(screen.getByRole("link", { name: "Click Here" })).toBeTruthy());
  });

  it("stays invisible while the banner is disabled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ enabled: false }), { status: 200 }))
    );

    const { container } = render(<PollBannerNotice />);

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it("stays invisible when the endpoint fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );

    const { container } = render(<PollBannerNotice />);

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });
});

describe("PollBannerNotice on chromeless pages", () => {
  function stubEnabled() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(ENABLED), { status: 200 }))
    );
  }

  // The navbar is hidden on these, so a banner would otherwise float at the very
  // top of the page with nothing above it.
  it.each(["/login", "/register", "/banned", "/maintenance"])(
    "renders nothing on %s even while the banner is enabled",
    async (pathname) => {
      setMockPathname(pathname);
      stubEnabled();

      const { container } = render(<PollBannerNotice />);

      expect(container.firstChild).toBeNull();
      // And it does not poll the endpoint every minute for a banner it will
      // never draw. /login is a high-traffic anonymous page.
      await waitFor(() => expect(container.firstChild).toBeNull());
      expect(globalThis.fetch).not.toHaveBeenCalled();
    }
  );

  it("still renders on an ordinary page", async () => {
    setMockPathname("/world");
    stubEnabled();

    render(<PollBannerNotice />);

    await waitFor(() => expect(screen.getByRole("link", { name: "Click Here" })).toBeTruthy());
  });
});

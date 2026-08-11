/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { LocalTime, RelativeTime } from "./LocalTime";
import { formatStableUtc } from "@/lib/time/localTime";

const DATE_OPTS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
};

describe("LocalTime SSR pass (hydration-safety contract)", () => {
  it("server-renders the deterministic UTC string and a machine-readable dateTime", () => {
    const iso = "2026-06-03T00:30:00.000Z";
    const html = renderToStaticMarkup(<LocalTime value={iso} options={DATE_OPTS} />);
    expect(html).toContain(formatStableUtc(iso, DATE_OPTS)); // "Jun 3, 2026"
    // HTML attributes are case-insensitive; renderToStaticMarkup emits camelCase `dateTime`.
    expect(html.toLowerCase()).toContain(`datetime="${iso.toLowerCase()}"`);
  });
});

describe("LocalTime client pass", () => {
  it("renders the user-local formatted string after mount", () => {
    const iso = "2026-06-02T16:52:20.000Z";
    const { container } = render(<LocalTime value={iso} options={DATE_OPTS} />);
    expect(container.textContent).toBe(new Date(iso).toLocaleString(undefined, DATE_OPTS));
  });
});

describe("RelativeTime", () => {
  it("server-renders an absolute UTC date, not a relative phrase", () => {
    const iso = "2026-06-02T16:52:20.000Z";
    const html = renderToStaticMarkup(<RelativeTime value={iso} />);
    expect(html).not.toContain("ago");
    expect(html).toContain(formatStableUtc(iso, DATE_OPTS));
  });

  it("renders a relative phrase after mount", () => {
    const fiveMinAgo = new Date(Date.now() - (5 * 60_000 + 2_000));
    const { container } = render(<RelativeTime value={fiveMinAgo} />);
    expect(container.textContent).toBe("5m ago");
  });
});

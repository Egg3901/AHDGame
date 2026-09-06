/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PatreonBadge } from "./PatreonBadge";

/**
 * The badge is how a supporter is recognised on their own profile and on
 * everyone else's. Its copy has to be accurate about who they actually pay:
 * describing a Lakeside subscriber as a Patreon patron is wrong in the one
 * place they went out of their way to be seen.
 */
describe("PatreonBadge", () => {
  it("shows nothing for a non-supporter", () => {
    const { container } = render(<PatreonBadge tier={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("names each tier", () => {
    render(<PatreonBadge tier="supporter" />);
    expect(screen.getByText("Supporter")).toBeTruthy();

    render(<PatreonBadge tier="supporter-plus" />);
    expect(screen.getByText("Supporter+")).toBeTruthy();

    render(<PatreonBadge tier="supporter-plus-plus" />);
    expect(screen.getByText("Supporter++")).toBeTruthy();
  });

  it("credits a Lakeside subscription rather than implying Patreon", () => {
    render(<PatreonBadge tier="supporter" provider="stripe" />);
    expect(screen.getByTitle(/Lakeside subscription/i)).toBeTruthy();
  });

  it("stays quiet about the provider for a Patreon patron", () => {
    render(<PatreonBadge tier="supporter" provider="patreon" />);
    expect(screen.queryByTitle(/Lakeside subscription/i)).toBeNull();
  });

  it("stays quiet about the provider when none is known", () => {
    render(<PatreonBadge tier="supporter" />);
    expect(screen.queryByTitle(/Lakeside subscription/i)).toBeNull();
  });

  it("reports how long someone has supported", () => {
    const since = new Date();
    since.setFullYear(since.getFullYear() - 2);
    since.setMonth(since.getMonth() - 3);

    render(<PatreonBadge tier="supporter" since={since} />);
    expect(screen.getByTitle(/2y 3m/)).toBeTruthy();
  });

  it("does not round a brand-new supporter up to a month", () => {
    render(<PatreonBadge tier="supporter" since={new Date()} />);
    expect(screen.getByTitle(/less than 1 month/i)).toBeTruthy();
  });
});

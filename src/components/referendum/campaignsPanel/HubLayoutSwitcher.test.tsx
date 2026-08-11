/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/country/uk/referendums",
  useSearchParams: () => new URLSearchParams(""),
}));

import { HubLayoutSwitcher } from "./HubLayoutSwitcher";

describe("HubLayoutSwitcher", () => {
  it("pushes the chosen layout to the query", () => {
    render(<HubLayoutSwitcher active="cards" />);
    fireEvent.click(screen.getByRole("button", { name: /arena/i }));
    expect(push).toHaveBeenCalledWith("/country/uk/referendums?layout=arena");
  });
});

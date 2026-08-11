/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PrimaryElectoralMap } from "./PrimaryElectoralMap";
import { PrimaryMapWithLinks } from "@/app/president/primary/[partyId]/PrimaryMapWithLinks";

vi.mock("@/components/USAMapPaths", () => ({
  USAMapPaths: (props: { stateData: Record<string, { label?: string; tooltip?: string[] }> }) => {
    const ids = Object.keys(props.stateData).sort();
    return (
      <div data-testid="mock-map">
        {ids.map((id) => (
          <div key={id} data-testid={`state-${id}`}>
            <span data-testid={`label-${id}`}>{props.stateData[id].label}</span>
            <span data-testid={`tooltip-${id}`}>
              {(props.stateData[id].tooltip ?? []).join("|")}
            </span>
          </div>
        ))}
      </div>
    );
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/president/primary/1",
  useSearchParams: () => new URLSearchParams(),
}));

describe("PrimaryElectoralMap", () => {
  const baseStateData = {
    CA: {
      color: "#ff0000",
      label: "CA",
      tooltip: ["Projected results:", "Alice — 55.0%", "Bob — 45.0%"],
      delegateLabel: "55",
      delegateTooltip: ["55 delegates available", "Alice: 30", "Bob: 25"],
    },
    TX: {
      color: "#0000ff",
      label: "TX",
      tooltip: ["Projected results:", "Bob — 60.0%", "Alice — 40.0%"],
      delegateLabel: "40",
      delegateTooltip: ["40 delegates available", "Bob: 40", "Alice: 0"],
    },
  };

  it("defaults to leader mode and renders state labels/tooltips", () => {
    render(<PrimaryElectoralMap stateData={baseStateData} />);
    expect(screen.getByTestId("label-CA").textContent).toBe("CA");
    expect(screen.getByTestId("tooltip-CA").textContent).toContain("Alice");
    expect(screen.getByTestId("label-TX").textContent).toBe("TX");
  });

  it("switches to delegate labels and tooltips when mode is delegates", () => {
    render(<PrimaryElectoralMap stateData={baseStateData} mode="delegates" />);
    expect(screen.getByTestId("label-CA").textContent).toBe("55");
    expect(screen.getByTestId("tooltip-CA").textContent).toBe(
      "55 delegates available|Alice: 30|Bob: 25"
    );
    expect(screen.getByTestId("label-TX").textContent).toBe("40");
    expect(screen.getByTestId("tooltip-TX").textContent).toBe(
      "40 delegates available|Bob: 40|Alice: 0"
    );
  });

  it("falls back to leader label/tooltip when delegate fields are missing", () => {
    const partialData = {
      CA: {
        color: "#ff0000",
        label: "CA",
        tooltip: ["Leader mode"],
      },
    };
    render(<PrimaryElectoralMap stateData={partialData} mode="delegates" />);
    expect(screen.getByTestId("label-CA").textContent).toBe("CA");
    expect(screen.getByTestId("tooltip-CA").textContent).toBe("Leader mode");
  });
});

describe("PrimaryMapWithLinks delegate toggle", () => {
  it("renders Leader and Delegates toggle buttons", () => {
    render(
      <PrimaryMapWithLinks
        partyId="1"
        stateData={{
          CA: {
            color: "#ff0000",
            label: "CA",
            tooltip: ["Projected"],
            delegateLabel: "55",
            delegateTooltip: ["55 delegates"],
          },
        }}
      />
    );
    expect(screen.getByRole("button", { name: "Leader" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delegates" })).toBeTruthy();
  });

  it("switches to delegate mode when the Delegates button is clicked", () => {
    render(
      <PrimaryMapWithLinks
        partyId="1"
        stateData={{
          CA: {
            color: "#ff0000",
            label: "CA",
            tooltip: ["Projected"],
            delegateLabel: "55",
            delegateTooltip: ["55 delegates"],
          },
        }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Delegates" }));
    expect(screen.getByTestId("label-CA").textContent).toBe("55");
    expect(screen.getByTestId("tooltip-CA").textContent).toBe("55 delegates");
  });
});

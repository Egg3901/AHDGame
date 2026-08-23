/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NuclearTab, type NuclearStatusView } from "./NuclearTab";
import { NUCLEAR_NODES, nuclearNodeStatus } from "@/lib/military/nuclearProgram";

afterEach(cleanup);

/** A live 1957 programme: fission tested, bombers fielded, boosted and IRBM in reach. */
function statusView(over: Partial<NuclearStatusView> = {}): NuclearStatusView {
  const adopted = { "device-fission": 4, "delivery-bombers": 6 };
  return {
    program: { adopted, warheads: 12, productionRate: 1, lastTestTurn: 4 },
    nodes: NUCLEAR_NODES.map((node) => ({
      ...node,
      status: nuclearNodeStatus(node, adopted, 1957),
    })),
    productionCap: 2,
    warheadUnitCost: 800,
    deterrence: 19,
    eligibility: { capable: true, coldWarEnabled: true, doctrineAdopted: true, eligible: true },
    year: 1957,
    ...over,
  };
}

function setup(over: Partial<React.ComponentProps<typeof NuclearTab>> = {}) {
  return render(
    <NuclearTab
      status={statusView()}
      currencySymbol="$"
      canAct
      busy={false}
      onConductTest={vi.fn(async () => true)}
      onAdoptDelivery={vi.fn(async () => true)}
      onSetProduction={vi.fn(async () => true)}
      {...over}
    />
  );
}

describe("NuclearTab", () => {
  it("shows a loading card while the flagship's fetch is in flight", () => {
    setup({ status: undefined });
    expect(screen.getByText(/Loading the nuclear programme/)).toBeTruthy();
  });

  // A locked programme must say why, gate by gate, rather than showing a dead tree.
  it("explains the three entry gates when ineligible", () => {
    setup({
      status: statusView({
        eligibility: {
          capable: true,
          coldWarEnabled: true,
          doctrineAdopted: false,
          eligible: false,
        },
      }),
    });
    expect(screen.getByText(/Three gates open it/)).toBeTruthy();
    expect(screen.getByText(/Nuclear Delivery/)).toBeTruthy();
    expect(screen.getByText(/Cold War subsystem/)).toBeTruthy();
    expect(screen.queryByText("Device ladder")).toBeNull();
  });

  it("shows the stockpile, deterrence and production order", () => {
    setup();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("19 / 100")).toBeTruthy();
    expect(screen.getByText("1 / 2 per turn")).toBeTruthy();
  });

  it("renders both tree columns with every node", () => {
    setup();
    expect(screen.getByText("Device ladder")).toBeTruthy();
    expect(screen.getByText("Delivery legs")).toBeTruthy();
    for (const node of NUCLEAR_NODES) {
      expect(screen.getByText(node.name)).toBeTruthy();
    }
  });

  it("marks a not-yet-invented node with its year rather than a dead 'locked'", () => {
    setup();
    // MIRV is 1968; the fixture year is 1957.
    expect(screen.getByText("From 1968")).toBeTruthy();
  });

  // A test spikes tension for the whole world, so it takes two clicks.
  it("requires confirmation before conducting a test", () => {
    const onConductTest = vi.fn(async () => true);
    setup({ onConductTest });
    fireEvent.click(screen.getByRole("button", { name: /conduct test/i }));
    expect(onConductTest).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /confirm test/i }));
    expect(onConductTest).toHaveBeenCalledWith("device-boosted");
  });

  it("adopts an available delivery leg in one click", () => {
    const onAdoptDelivery = vi.fn(async () => true);
    setup({ onAdoptDelivery });
    fireEvent.click(screen.getByRole("button", { name: /^adopt$/i }));
    expect(onAdoptDelivery).toHaveBeenCalledWith("delivery-irbm");
  });

  it("sets a production rate inside the device tier's cap", () => {
    const onSetProduction = vi.fn(async () => true);
    setup({ onSetProduction });
    fireEvent.change(screen.getByLabelText("Warheads per turn"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /set rate/i }));
    expect(onSetProduction).toHaveBeenCalledWith(2);
  });

  it("refuses a rate past the cap", () => {
    const onSetProduction = vi.fn(async () => true);
    setup({ onSetProduction });
    fireEvent.change(screen.getByLabelText("Warheads per turn"), { target: { value: "5" } });
    expect((screen.getByRole("button", { name: /set rate/i }) as HTMLButtonElement).disabled).toBe(
      true
    );
    expect(screen.getByText(/between 0 and 2/)).toBeTruthy();
  });

  it("tells a deviceless programme to test before ordering production", () => {
    setup({
      status: statusView({
        program: { adopted: {}, warheads: 0, productionRate: 0, lastTestTurn: null },
        productionCap: 0,
        warheadUnitCost: 0,
        deterrence: 0,
      }),
    });
    expect(screen.getByText(/Conduct a test before ordering production/)).toBeTruthy();
  });

  it("offers no controls to a viewer who cannot act", () => {
    setup({ canAct: false });
    expect(screen.queryByRole("button", { name: /conduct test/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^adopt$/i })).toBeNull();
  });
});

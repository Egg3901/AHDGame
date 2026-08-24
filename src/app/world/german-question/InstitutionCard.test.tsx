// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DossierInstitutionView } from "@/lib/settlement/queries/dossier";
import { InstitutionCard } from "./InstitutionCard";

function institution(over: Partial<DossierInstitutionView> = {}): DossierInstitutionView {
  return {
    id: "street",
    name: "The Street",
    subtitle: "Demonstrations · union halls · student left",
    weightTag: "×2 WEIGHT",
    eastPct: 61,
    westPct: 39,
    driftNote: "0.0 · steady",
    driftDirection: "none",
    holder: "PACT",
    lastPlayLabel: null,
    plays: [],
    gateNote: null,
    personalCap: null,
    ...over,
  };
}

describe("InstitutionCard", () => {
  it("shows used against limit while the category has room left", () => {
    render(
      <InstitutionCard
        institution={institution({
          personalCap: { rawPoints: 2.5, netPoints: 2.5, capPoints: 6, maxed: false },
        })}
        mode="personal"
        seatName={null}
        onCommitted={() => {}}
      />
    );
    expect(screen.getByTestId("open-floor-cap").textContent).toContain("+2.50 / ±6.00");
    expect(screen.queryByText("MAXED")).toBeNull();
  });

  it("flags a maxed category unmistakably and says what it means", () => {
    render(
      <InstitutionCard
        institution={institution({
          personalCap: { rawPoints: 20, netPoints: 6, capPoints: 6, maxed: true },
        })}
        mode="personal"
        seatName={null}
        onCommitted={() => {}}
      />
    );
    expect(screen.getByText("MAXED")).toBeTruthy();
    expect(screen.getByTestId("open-floor-cap").textContent).toContain("+6.00 / ±6.00");
    // The badge alone is not enough: say plainly that further plays buy nothing.
    expect(screen.getByText(/reached its limit/i).textContent).toContain(
      "move nothing here until the next tick"
    );
  });

  it("renders no meter where the personal tier cannot reach", () => {
    render(
      <InstitutionCard
        institution={institution()}
        mode="seat"
        seatName="DD"
        onCommitted={() => {}}
      />
    );
    expect(screen.queryByTestId("open-floor-cap")).toBeNull();
  });
});

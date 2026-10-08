/** @vitest-environment happy-dom */
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BillProvisionsSection } from "./BillProvisionsSection";

vi.mock("./BillProvisionCard", () => ({
  BillProvisionCard: ({ index }: { index: number }) => <div>Provision {index + 1}</div>,
}));
vi.mock("@/lib/legislature/dto/provisionView", () => ({
  provisionToView: (value: unknown) => value,
}));

afterEach(cleanup);

describe("BillProvisionsSection", () => {
  it.each([undefined, []])(
    "explains absent provisions without hiding the section",
    (provisions) => {
      render(
        <BillProvisionsSection provisions={provisions}>
          <div>Effects</div>
        </BillProvisionsSection>
      );
      expect(screen.getByRole("heading", { name: "Provisions" })).toBeTruthy();
      expect(screen.getByText("No policy provisions are recorded for this bill.")).toBeTruthy();
      expect(screen.queryByText("Effects")).toBeNull();
    }
  );

  it("renders every provision and optional regional effects", () => {
    render(
      <BillProvisionsSection provisions={[{}, {}] as never}>
        <div>Effects</div>
      </BillProvisionsSection>
    );
    expect(screen.getByText("Provision 1")).toBeTruthy();
    expect(screen.getByText("Provision 2")).toBeTruthy();
    expect(screen.getByText("Effects")).toBeTruthy();
  });
});

/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TariffProvisionEditor } from "./TariffProvisionEditor";
import type { TariffProvisionInput } from "./tariffProvisionTypes";

describe("TariffProvisionEditor", () => {
  const baseProps = {
    countryId: "UK" as const,
    enabledCountryIds: ["US", "UK", "DE", "JP"] as const,
  };

  it("renders one row by default when value is empty", () => {
    const onChange = vi.fn();
    render(<TariffProvisionEditor {...baseProps} value={[]} onChange={onChange} />);
    expect(screen.getAllByLabelText(/scope/i)).toHaveLength(1);
  });

  it("shows the sector dropdown when scope is 'sector'", () => {
    const rows: TariffProvisionInput[] = [{ scopeType: "sector", rate: 10 }];
    render(<TariffProvisionEditor {...baseProps} value={rows} onChange={vi.fn()} />);
    expect(screen.getByLabelText(/target sector/i)).toBeDefined();
  });

  it("shows the origin country dropdown when scope is 'origin_country' and excludes proposer", () => {
    const rows: TariffProvisionInput[] = [
      { scopeType: "origin_country", targetOriginCountryId: "US", rate: 10 },
    ];
    render(<TariffProvisionEditor {...baseProps} value={rows} onChange={vi.fn()} />);
    const select = screen.getByLabelText(/origin country/i) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).not.toContain("UK");
    expect(options).toContain("US");
  });

  it("hides the target field when scope is 'economy_wide'", () => {
    const rows: TariffProvisionInput[] = [{ scopeType: "economy_wide", rate: 10 }];
    render(<TariffProvisionEditor {...baseProps} value={rows} onChange={vi.fn()} />);
    expect(screen.queryByLabelText(/target sector/i)).toBeNull();
    expect(screen.queryByLabelText(/origin country/i)).toBeNull();
  });

  it("emits a new row when Add is clicked", () => {
    const onChange = vi.fn();
    render(
      <TariffProvisionEditor
        {...baseProps}
        value={[{ scopeType: "economy_wide", rate: 10 }]}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0][0] as TariffProvisionInput[];
    expect(next).toHaveLength(2);
  });

  it("disables Add at 3 rows", () => {
    render(
      <TariffProvisionEditor
        {...baseProps}
        value={[
          { scopeType: "economy_wide", rate: 10 },
          { scopeType: "sector", targetSectorType: "automobiles", rate: 10 },
          { scopeType: "origin_country", targetOriginCountryId: "US", rate: 10 },
        ]}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /add/i }).hasAttribute("disabled")).toBe(true);
  });

  it("emits a row update when Rate changes", () => {
    const onChange = vi.fn();
    render(
      <TariffProvisionEditor
        {...baseProps}
        value={[{ scopeType: "economy_wide", rate: 10 }]}
        onChange={onChange}
      />
    );
    fireEvent.input(screen.getByLabelText(/rate/i), { target: { value: "25" } });
    const next = onChange.mock.calls[0][0] as TariffProvisionInput[];
    expect(next[0].rate).toBe(25);
  });
});

// @vitest-environment happy-dom
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en/elections.json";
import { Hu1991ConstituencyPicker } from "./Hu1991ConstituencyPicker";
afterEach(cleanup);
describe("Hungarian constituency filing selector", () => {
  it("offers the 32 Budapest constituencies and sends one chosen district", () => {
    const onChange = vi.fn();
    render(
      <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
        <Hu1991ConstituencyPicker regionId="HU_BUD" value="" onChange={onChange} />
      </NextIntlClientProvider>
    );
    const selector = screen.getByRole("combobox", { name: "Your constituency" });
    expect(screen.getAllByRole("option")).toHaveLength(33);
    expect(screen.getByRole("option", { name: "Budapest, constituency 32" })).toBeTruthy();
    fireEvent.change(selector, { target: { value: "HU-constituency-01-12" } });
    expect(onChange).toHaveBeenCalledWith("HU-constituency-01-12");
    expect(screen.getByText(/You can win one seat/)).toBeTruthy();
  });
  it("shows only the statutory districts inside the player's campaign region", () => {
    render(
      <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
        <Hu1991ConstituencyPicker regionId="HU_NOR" value="" onChange={() => {}} />
      </NextIntlClientProvider>
    );
    expect(screen.getAllByRole("option")).toHaveLength(24);
    expect(screen.queryByRole("option", { name: "Budapest, constituency 1" })).toBeNull();
    expect(screen.getByRole("option", { name: "Heves, constituency 6" })).toBeTruthy();
  });
  it("offers only vacant constituencies during a by-election", () => {
    render(
      <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
        <Hu1991ConstituencyPicker
          regionId="HU_BUD"
          value=""
          onChange={() => {}}
          allowedDistrictIds={["HU-constituency-01-12", "HU-constituency-01-20"]}
        />
      </NextIntlClientProvider>
    );
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.queryByRole("option", { name: "Budapest, constituency 1" })).toBeNull();
    expect(screen.getByRole("option", { name: "Budapest, constituency 12" })).toBeTruthy();
  });
});

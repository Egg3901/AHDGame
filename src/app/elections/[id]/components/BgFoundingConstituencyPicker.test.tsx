// @vitest-environment happy-dom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en/elections.json";
import { BG_1990_CONSTITUENCIES } from "@/lib/countries/bg/data/foundingDistricts1990";
import { BgFoundingConstituencyPicker } from "./BgFoundingConstituencyPicker";

afterEach(cleanup);
describe("Bulgarian founding constituency filing selector", () => {
  it("offers only local constituencies and sends the chosen seat", () => {
    const onChange = vi.fn();
    render(
      <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
        <BgFoundingConstituencyPicker regionId="BG_SOF" value="" onChange={onChange} />
      </NextIntlClientProvider>
    );
    const districts = BG_1990_CONSTITUENCIES.filter((row) => row.regionId === "BG_SOF");
    const selector = screen.getByRole("combobox", { name: "Grand Assembly constituency" });
    expect(screen.getAllByRole("option")).toHaveLength(districts.length + 1);
    expect(screen.getByRole("option", { name: "Sofia city, constituency 1" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Burgas, constituency 1" })).toBeNull();
    fireEvent.change(selector, { target: { value: districts[0].id } });
    expect(onChange).toHaveBeenCalledWith(districts[0].id);
    expect(screen.getByText(/You can hold only one seat/)).toBeTruthy();
  });
});

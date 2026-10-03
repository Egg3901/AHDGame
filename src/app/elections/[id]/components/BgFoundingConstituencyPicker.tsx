"use client";

import { useTranslations } from "next-intl";
import {
  BG_1990_CONSTITUENCIES,
  BG_1990_LIST_DISTRICTS,
} from "@/lib/countries/bg/data/foundingDistricts1990";

export function BgFoundingConstituencyPicker({
  regionId,
  value,
  onChange,
}: {
  regionId: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const t = useTranslations("elections.bgFounding");
  const areas = new Map(BG_1990_LIST_DISTRICTS.map((row) => [row.id, row.label]));
  return (
    <div className="mb-4">
      <label htmlFor="bg-founding-constituency" className="mb-2 block text-sm font-medium">
        {t("constituencyLabel")}
      </label>
      <select
        id="bg-founding-constituency"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
      >
        <option value="">{t("automatic")}</option>
        {BG_1990_CONSTITUENCIES.filter((row) => row.regionId === regionId).map((row) => (
          <option key={row.id} value={row.id}>
            {t("constituency", {
              area: areas.get(row.listDistrictId)!,
              number: row.districtNumber,
            })}
          </option>
        ))}
      </select>
      <p className="mt-2 text-sm text-muted-foreground">{t("filingNote")}</p>
    </div>
  );
}

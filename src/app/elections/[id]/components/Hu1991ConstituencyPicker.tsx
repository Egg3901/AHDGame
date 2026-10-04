"use client";

import { useTranslations } from "next-intl";
import {
  HU_1991_CONSTITUENCIES,
  HU_1991_TERRITORIAL_DISTRICTS,
} from "@/lib/countries/hu/data/electoralDistricts1991";

export function Hu1991ConstituencyPicker({
  regionId,
  allowedDistrictIds,
  value,
  onChange,
}: {
  regionId: string;
  allowedDistrictIds?: readonly string[];
  value: string;
  onChange: (id: string) => void;
}) {
  const t = useTranslations("elections.hu1991");
  const local = HU_1991_CONSTITUENCIES.filter(
    (row) =>
      row.regionId === regionId && (!allowedDistrictIds || allowedDistrictIds.includes(row.id))
  );
  const counties = new Map(HU_1991_TERRITORIAL_DISTRICTS.map((row) => [row.id, row.label]));
  return (
    <div className="mb-4 rounded-lg border border-border bg-card p-4">
      <label htmlFor="hu1991-constituency" className="mb-2 block text-sm font-medium">
        {t("constituencyLabel")}
      </label>
      <select
        id="hu1991-constituency"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
      >
        <option value="">{t("automatic")}</option>
        {local.map((row) => (
          <option key={row.id} value={row.id}>
            {t("constituency", { county: counties.get(row.countyId)!, number: row.districtNumber })}
          </option>
        ))}
      </select>
      <p className="mt-2 text-sm text-muted-foreground">{t("filingNote")}</p>
    </div>
  );
}

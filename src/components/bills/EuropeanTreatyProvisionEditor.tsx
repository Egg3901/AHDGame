"use client";
import { useTranslations } from "next-intl";
export function EuropeanTreatyProvisionEditor({
  action,
  onChange,
}: {
  action: "" | "ratify" | "reject";
  onChange: (action: "" | "ratify" | "reject") => void;
}) {
  const t = useTranslations("worldOrganizations.maastricht");
  return (
    <label className="block text-sm">
      {t("title")}
      <select
        className="mt-2 w-full rounded border bg-card p-2"
        value={action}
        onChange={(event) => onChange(event.target.value as "" | "ratify" | "reject")}
      >
        <option value="">{t("include")}</option>
        <option value="ratify">{t("ratify")}</option>
        <option value="reject">{t("reject")}</option>
      </select>
    </label>
  );
}

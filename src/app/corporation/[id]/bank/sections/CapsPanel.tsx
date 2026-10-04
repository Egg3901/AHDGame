"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Tooltip } from "@/components/ui";
import { formatBankMoney } from "@/components/banking/formatBankMoney";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { ConsolePayload } from "../types";
import { Td, Th } from "@/components/corporation/dense/DenseKit";
import { BankPanel } from "../components/BankSection";

/**
 * Every cap that can stop a player, with the rule and the numbers in it.
 *
 * Three separate tickets (1090, 1111, 1113) were the same complaint in
 * different clothes: the console printed a number, the number blocked an
 * action, and nothing on screen said how the number was arrived at. A player
 * could only learn a cap by hitting it, and when two screens disagreed there
 * was no way to tell which one was lying.
 *
 * The rows come from `explainBankCaps`, which is computed by the same module
 * that ENFORCES the caps, so the explanation cannot drift away from the rule
 * the way a hand-written help string does.
 */
export function CapsPanel({ data }: { data: ConsolePayload }) {
  const t = useTranslations("corporations.bankConsole");
  const caps = data.caps;
  if (!caps || caps.length === 0) return null;
  const currency = data.currency as CurrencyCode;

  return (
    <BankPanel
      kind="reference"
      title="Your limits, and where they come from"
      actions={
        <Link
          href="/wiki/private-banking"
          className="text-xs text-foreground underline decoration-card-border underline-offset-2 hover:decoration-foreground"
        >
          How banking works
        </Link>
      }
    >
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <Th>Limit</Th>
            <Th align="right">Value</Th>
            <Th>What moves it</Th>
          </tr>
        </thead>
        <tbody>
          {caps.map((cap) => (
            <tr key={cap.key} className="align-top">
              <Td className="text-foreground">
                {cap.label}
                <Tooltip
                  content={t("tooltips.capFormula", {
                    formula: cap.formula,
                    inputs: cap.inputs
                      .map((input) =>
                        input.unit === "percent"
                          ? `${input.label} ${(input.value * 100).toFixed(1)}%`
                          : `${input.label} ${formatBankMoney(input.value, currency)}`
                      )
                      .join("; "),
                  })}
                  label={t("tooltips.capFormulaLabel", { label: cap.label })}
                />
              </Td>
              <Td align="right">{formatBankMoney(cap.value, currency)}</Td>
              <Td wrap className="text-xs text-muted">
                {cap.lever}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </BankPanel>
  );
}

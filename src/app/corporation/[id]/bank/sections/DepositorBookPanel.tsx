"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { BankDepositorBook } from "@/lib/banking/depositorBook";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { formatBankMoney } from "@/components/banking/formatBankMoney";
import { TableScroll, Td, Th } from "@/components/corporation/dense/DenseKit";
import { BankPanel } from "../components/BankSection";

export function DepositorBookPanel({
  book,
  currency,
  householdDeposits,
}: {
  book: BankDepositorBook;
  currency: CurrencyCode;
  householdDeposits: number;
}) {
  const t = useTranslations("corporations.bankConsole.depositors");
  return (
    <BankPanel kind="monitor" title={t("title")}>
      <p className="py-2 text-xs text-muted">{t("description")}</p>
      {book.source === "legacy" && <p className="pb-2 text-xs text-muted">{t("legacy")}</p>}
      <TableScroll>
        <table className="w-full min-w-[320px] border-collapse">
          <thead>
            <tr>
              <Th>{t("depositor")}</Th>
              <Th align="right">{t("balance")}</Th>
            </tr>
          </thead>
          <tbody>
            {book.rows.map((row) => (
              <tr key={`${row.type}:${row.key}`}>
                <Td>
                  {row.name && row.type === "character" && row.sequentialId !== null ? (
                    <Link className="hover:underline" href={`/character/${row.sequentialId}`}>
                      {row.name}
                    </Link>
                  ) : (
                    (row.name ?? t("unknown"))
                  )}
                </Td>
                <Td align="right">{formatBankMoney(row.balance, currency)}</Td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <Td>{t("total")}</Td>
              <Td align="right">{formatBankMoney(book.total, currency)}</Td>
            </tr>
          </tfoot>
        </table>
      </TableScroll>
      {book.rows.length === 0 && <p className="py-2 text-xs text-muted">{t("empty")}</p>}
      <p className="py-2 text-xs text-muted">
        {t("households", { amount: formatBankMoney(householdDeposits, currency) })}
      </p>
    </BankPanel>
  );
}

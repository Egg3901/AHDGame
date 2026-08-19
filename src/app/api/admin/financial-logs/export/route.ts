// GET /api/admin/financial-logs/export — CSV export of the same filterable view
// shown in the Admin Panel ledger. Re-uses buildTxLogFilter so URL parameters
// behave identically to the paginated endpoint, but bypasses the page-size
// limit (50 rows) and streams the result as text/csv with a download header.
//
// Auth: requireAdmin
// Errors: 400, 403
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { buildTxLogFilter } from "@/lib/financialTxLog/queryLogs";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";

const MAX_EXPORT_ROWS = 50_000;

const CSV_COLUMNS: (keyof FinancialTxLogEntry | "subjectIdHex" | "counterpartyIdHex")[] = [
  "_id",
  "type",
  "turn",
  "createdAt",
  "subjectType",
  "subjectIdHex",
  "subjectName",
  "subjectSequentialId",
  "subjectDeletedAt",
  "amount",
  "currencyCode",
  "balanceAfter",
  "counterpartyType",
  "counterpartyIdHex",
  "counterpartyName",
  "counterpartySequentialId",
  "counterpartyDeletedAt",
  "flagged",
];

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = value instanceof Date ? value.toISOString() : String(value);
  // Quote if it contains comma / quote / newline; double-up internal quotes.
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const built = buildTxLogFilter(searchParams);
    if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 });

    const db = await getDb();

    // Stream rows out via the cursor instead of toArray() so we don't pin
    // 50k docs in memory. CSV writer concatenates into chunks but stays
    // bounded by the row cap.
    const cursor = db
      .collection<FinancialTxLogEntry>("financialTxLog")
      .find(built.filter)
      .sort({ _id: -1 })
      .limit(MAX_EXPORT_ROWS);

    const lines: string[] = [CSV_COLUMNS.join(",")];
    let count = 0;
    for await (const row of cursor) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = row as unknown as Record<string, any>;
      lines.push(
        CSV_COLUMNS.map((col) => {
          if (col === "subjectIdHex") return escapeCsv(r.subjectId?.toString());
          if (col === "counterpartyIdHex") return escapeCsv(r.counterpartyId?.toString());
          return escapeCsv(r[col]);
        }).join(",")
      );
      count++;
    }

    const filename = `financial-tx-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
    return new NextResponse(lines.join("\r\n") + "\r\n", {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Total-Rows": String(count),
        "X-Capped": String(count === MAX_EXPORT_ROWS),
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

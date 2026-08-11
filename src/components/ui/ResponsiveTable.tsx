"use client";

import type { ReactNode } from "react";

export interface ResponsiveTableColumn<T> {
  key: string;
  header: string;
  mobileLabel?: string;
  render: (row: T) => ReactNode;
  hideOnMobile?: boolean;
}

interface ResponsiveTableProps<T> {
  columns: ResponsiveTableColumn<T>[];
  data: T[];
  keyExtractor: (row: T) => string;
  emptyMessage: string;
  footer?: ReactNode;
  renderActions?: (row: T) => ReactNode;
  cardClassName?: string;
}

export function ResponsiveTable<T>({
  columns,
  data,
  keyExtractor,
  emptyMessage,
  footer,
  renderActions,
  cardClassName = "",
}: ResponsiveTableProps<T>) {
  const visibleColumns = columns.filter((c) => !c.hideOnMobile);

  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
      {/* Desktop: table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-background/50">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="px-4 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider"
                >
                  {col.header}
                </th>
              ))}
              {renderActions && (
                <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase tracking-wider">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-card-border">
            {data.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (renderActions ? 1 : 0)}
                  className="px-4 py-8 text-center text-muted"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              data.map((row) => (
                <tr
                  key={keyExtractor(row)}
                  className="hover:bg-background/40 transition-colors duration-150"
                >
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-3">
                      {col.render(row)}
                    </td>
                  ))}
                  {renderActions && <td className="px-4 py-3 text-right">{renderActions(row)}</td>}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards */}
      <div className="md:hidden divide-y divide-card-border">
        {data.length === 0 ? (
          <div className="px-4 py-8 text-center text-muted">{emptyMessage}</div>
        ) : (
          data.map((row) => (
            <div key={keyExtractor(row)} className={`p-4 space-y-3 ${cardClassName}`}>
              {visibleColumns.map((col) => (
                <div key={col.key} className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium text-muted uppercase tracking-wider">
                    {col.mobileLabel ?? col.header}
                  </span>
                  <div className="text-sm">{col.render(row)}</div>
                </div>
              ))}
              {renderActions && (
                <div className="pt-2 flex flex-wrap gap-2 min-h-[44px] items-center">
                  {renderActions(row)}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {footer && data.length > 0 && (
        <div className="border-t border-card-border bg-background/30 px-4 py-3 text-sm text-muted">
          {footer}
        </div>
      )}
    </div>
  );
}

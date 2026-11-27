import type { ReactNode } from "react";

import { Button } from "./button.js";

export interface TableColumn<Row> {
  readonly key: string;
  readonly header: ReactNode;
  readonly cell: (row: Row) => ReactNode;
  readonly align?: "left" | "right";
  /** Optional CSS width, e.g. "10rem". */
  readonly width?: string;
}

export interface TablePagination {
  /** Shown at the left of the footer, e.g. "25 nesta página". */
  readonly summary?: ReactNode;
  readonly hasMore: boolean;
  readonly onLoadMore: () => void;
  readonly loadingMore?: boolean;
  readonly loadMoreLabel?: string;
  readonly loadingMoreLabel?: string;
}

export interface TableProps<Row> {
  /** Accessible name of the table; shown as a small caption unless `hideCaption`. */
  readonly caption: string;
  readonly hideCaption?: boolean;
  readonly columns: readonly TableColumn<Row>[];
  readonly rows: readonly Row[];
  readonly getRowKey: (row: Row) => string;
  readonly loading?: boolean;
  readonly loadingLabel?: string;
  /** Rendered instead of the table when there are no rows (usually an EmptyState). */
  readonly empty?: ReactNode;
  readonly pagination?: TablePagination | undefined;
}

const SKELETON_ROWS = 4;

export function Table<Row>({
  caption,
  hideCaption = true,
  columns,
  rows,
  getRowKey,
  loading = false,
  loadingLabel = "A carregar…",
  empty,
  pagination,
}: TableProps<Row>) {
  if (!loading && rows.length === 0 && empty !== undefined) return <>{empty}</>;

  return (
    <div aria-busy={loading || undefined}>
      <div className="ds-table-wrap">
        <table className="ds-table">
          <caption className={hideCaption ? "sr-only" : undefined}>{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={column.align === "right" ? "ds-align-right" : undefined}
                  style={column.width ? { width: column.width } : undefined}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: SKELETON_ROWS }, (_, index) => (
                  <tr key={index} aria-hidden="true">
                    {columns.map((column) => (
                      <td key={column.key}>
                        <span className="ds-skeleton" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row) => (
                  <tr key={getRowKey(row)}>
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={column.align === "right" ? "ds-align-right" : undefined}
                      >
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      {loading ? (
        <p className="sr-only" role="status">
          {loadingLabel}
        </p>
      ) : null}
      {!loading && pagination ? (
        <div className="ds-table__footer">
          <span>{pagination.summary}</span>
          {pagination.hasMore ? (
            <Button
              onClick={pagination.onLoadMore}
              disabled={pagination.loadingMore}
              aria-busy={pagination.loadingMore}
            >
              {pagination.loadingMore
                ? (pagination.loadingMoreLabel ?? "A carregar…")
                : (pagination.loadMoreLabel ?? "Carregar mais")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

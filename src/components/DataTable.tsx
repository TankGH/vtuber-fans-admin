import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { twMerge } from "tailwind-merge";
import { Button, EmptyState } from "@/components/ui";

export interface Column<T> {
  key: string;
  title: string;
  width?: string;
  render: (row: T) => ReactNode;
}

export function DataTable<T>({
  columns, rows, rowKey, onRowClick, emptyTitle = "暂无数据", emptyDesc = "调整筛选条件或先导入名单",
  page, pageSize, total, onPageChange,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  emptyDesc?: string;
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
}) {
  const pages = page && pageSize && total ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  return (
    <div className="flex flex-col gap-3 min-w-0">
      <div className="scroll-x w-full overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="glass-soft text-left">
              {columns.map((c) => (
                <th key={c.key} style={{ width: c.width }} className="px-3.5 py-3 label-sm font-medium whitespace-nowrap">{c.title}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={() => onRowClick?.(row)}
                className={twMerge("row-hover border-t border-[var(--border)]", onRowClick && "cursor-pointer")}
              >
                {columns.map((c) => <td key={c.key} className="px-3.5 py-3 whitespace-nowrap">{c.render(row)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <EmptyState title={emptyTitle} desc={emptyDesc} />}
      {page && onPageChange && (
        <div className="flex items-center justify-between gap-3 text-xs text-muted">
          <span>共 {total ?? rows.length} 条 · 第 {page} / {pages} 页</span>
          <div className="flex items-center gap-2">
            <Button className="px-2.5 py-1.5 text-xs" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="上一页">
              <ChevronLeft size={14} /> 上一页
            </Button>
            <Button className="px-2.5 py-1.5 text-xs" disabled={page >= pages} onClick={() => onPageChange(page + 1)} aria-label="下一页">
              下一页 <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

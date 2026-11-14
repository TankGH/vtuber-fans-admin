import { useCallback, useEffect, useRef, useState } from "react";
import { BarChart, Bar, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Wallet, TrendingUp, TrendingDown, Scale, Plus, Trash2, RefreshCw } from "lucide-react";
import { Badge, Button, Card, Field, Modal, SectionHint, SelectField } from "@/components/ui";
import { DataTable, type Column } from "@/components/DataTable";
import { callSafe } from "@/lib/ipc";
import { useApp } from "@/lib/appContext";
import type { GiftBatchDto, LedgerEntryDto, LedgerInput, LedgerSummaryDto, LedgerType } from "@/types/dto";

const CATEGORIES: Record<LedgerType, string[]> = {
  income: ["大航海", "其它收入", "活动赞助"],
  expense: ["舰礼采购", "快递费", "平台手续费", "其它支出"],
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function Ledger() {
  const { notify, refresh } = useApp();
  const [entries, setEntries] = useState<LedgerEntryDto[]>([]);
  const [summary, setSummary] = useState<LedgerSummaryDto | null>(null);
  const [batches, setBatches] = useState<GiftBatchDto[]>([]);
  const [entryType, setEntryType] = useState<LedgerType | "">("");
  const [month, setMonth] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<LedgerEntryDto | null>(null);
  const [busy, setBusy] = useState(false);
  const creatingRef = useRef(false);
  const [form, setForm] = useState<LedgerInput>({
    entryType: "expense", category: "舰礼采购", amountYuan: 0, occurredAt: today(), note: "", batchId: null,
  });

  const load = useCallback(async () => {
    const [list, sum, bs] = await Promise.all([
      callSafe<LedgerEntryDto[]>("ledger_list", { entryType, month }),
      callSafe<LedgerSummaryDto>("ledger_summary"),
      callSafe<GiftBatchDto[]>("gift_batch_list"),
    ]);
    if (list.data) setEntries(list.data);
    if (sum.data) setSummary(sum.data);
    if (bs.data) setBatches(bs.data);
    if (list.error || sum.error) notify({ tone: "error", title: "账本读取失败", detail: list.error?.action ?? sum.error?.action ?? "" });
  }, [entryType, month, notify]);

  useEffect(() => { load().catch((err: unknown) => console.error("账本加载失败：", err)); }, [load]);

  const createEntry = async () => {
    // 保存按钮在请求完成前可能被连续点击；用 ref 做重入锁，避免产生重复账目
    if (creatingRef.current) return;
    creatingRef.current = true;
    setBusy(true);
    try {
      const { error } = await callSafe("ledger_create", { ...form } as Record<string, unknown>);
      if (error) { notify({ tone: "error", title: "新增账目失败", detail: error.message }); return; }
      setAddOpen(false);
      notify({ tone: "success", title: "账目已记录", detail: `${form.category} ¥ ${Number(form.amountYuan).toFixed(2)}` });
      await load();
    } finally {
      creatingRef.current = false;
      setBusy(false);
    }
  };

  const removeEntry = async () => {
    if (!pendingDelete) return;
    const { error } = await callSafe("ledger_delete", { id: pendingDelete.id, confirm: true });
    setPendingDelete(null);
    if (error) { notify({ tone: "error", title: "删除失败", detail: error.action }); return; }
    await load();
  };

  const syncEvents = async () => {
    const { data, error } = await callSafe<LedgerSummaryDto>("ledger_sync_events");
    if (error) { notify({ tone: "error", title: "归集失败", detail: error.action }); return; }
    notify({ tone: "success", title: "归集完成", detail: `当前共 ${data?.entryCount ?? 0} 条账目，未归集事件 ${data?.unlinkedEventCount ?? 0} 条。` });
    await load();
    await refresh();
  };

  const cols: Column<LedgerEntryDto>[] = [
    { key: "date", title: "日期", width: "130px", render: (r) => <span className="masked-value">{r.occurredAt}</span> },
    { key: "type", title: "类型", width: "90px", render: (r) => <Badge tone={r.entryType === "income" ? "success" : "warning"}>{r.entryType === "income" ? "收入" : "支出"}</Badge> },
    { key: "category", title: "分类", width: "140px", render: (r) => <span className="font-medium">{r.category}</span> },
    { key: "amount", title: "金额", width: "120px", render: (r) => <span className={r.entryType === "income" ? "text-success font-medium" : "text-warning font-medium"}>{r.entryType === "income" ? "+" : "−"} ¥ {r.amountYuan.toFixed(2)}</span> },
    { key: "batch", title: "关联批次", width: "130px", render: (r) => <span className="text-xs text-muted">{batches.find((b) => b.id === r.batchId)?.name ?? (r.guardEventId ? "航海事件" : "—")}</span> },
    { key: "note", title: "备注", render: (r) => <span className="text-xs text-muted">{r.note || "—"}</span> },
    { key: "action", title: "操作", width: "90px", render: (r) => <Button variant="danger" className="text-xs" onClick={() => setPendingDelete(r)}><Trash2 size={13} /> 删除</Button> },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card className="flex items-center gap-3"><TrendingUp size={21} className="text-success" /><div><p className="label-sm">总收入</p><p className="text-xl font-semibold mt-1">¥ {summary?.totalIncomeYuan.toFixed(2) ?? "0.00"}</p></div></Card>
        <Card className="flex items-center gap-3"><TrendingDown size={21} className="text-warning" /><div><p className="label-sm">总支出</p><p className="text-xl font-semibold mt-1">¥ {summary?.totalExpenseYuan.toFixed(2) ?? "0.00"}</p></div></Card>
        <Card className="flex items-center gap-3"><Scale size={21} className="text-accent" /><div><p className="label-sm">净额</p><p className="text-xl font-semibold mt-1">¥ {summary?.netYuan.toFixed(2) ?? "0.00"}</p></div></Card>
        <Card className="flex items-center gap-3"><Wallet size={21} className="text-muted" /><div><p className="label-sm">账目条数</p><p className="text-xl font-semibold mt-1">{summary?.entryCount ?? 0}</p></div></Card>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <SelectField label="收支筛选" className="w-44" value={entryType} onChange={(e) => setEntryType(e.target.value as LedgerType | "")}>
          <option value="">全部</option><option value="income">仅收入</option><option value="expense">仅支出</option>
        </SelectField>
        <Field label="月份（YYYY-MM）" className="w-44" placeholder="留空为全部" value={month} onChange={(e) => setMonth(e.target.value)} />
        <Button variant="primary" onClick={() => setAddOpen(true)}><Plus size={14} /> 新增账目</Button>
        <Button onClick={syncEvents}><RefreshCw size={14} /> 归集大航海收入{summary?.unlinkedEventCount ? `（${summary.unlinkedEventCount}）` : ""}</Button>
      </div>

      <Card title="月度收支趋势" extra={<Badge tone="neutral">近 {summary?.buckets.length ?? 0} 个月</Badge>}>
        {(summary?.buckets.length ?? 0) === 0
          ? <p className="text-sm text-muted py-8 text-center">暂无账目，新增一笔后即可看到趋势。</p>
          : <ResponsiveContainer width="100%" height={260}>
            <BarChart data={summary?.buckets ?? []} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" tick={{ fill: "var(--text-muted)", fontSize: 12 }} />
              <YAxis tick={{ fill: "var(--text-muted)", fontSize: 12 }} />
              <Tooltip formatter={(value: number) => `¥ ${Number(value).toFixed(2)}`} />
              <Legend />
              <Bar dataKey="incomeYuan" name="收入" fill="var(--success)" radius={[5, 5, 0, 0]} />
              <Bar dataKey="expenseYuan" name="支出" fill="var(--warning)" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>}
      </Card>

      <Card title="账目明细" extra={<Badge tone="primary">{entries.length} 条</Badge>}>
        <DataTable columns={cols} rows={entries} rowKey={(r) => String(r.id)} emptyTitle="暂无账目" emptyDesc="手动新增一笔，或点击「归集大航海收入」把导入事件转成收入" />
      </Card>

      <SectionHint tone="neutral">
        大航海购买 / 续费事件按事件 ID 归集一次，重复点击不会产生重复收入；支出可关联舰礼寄送批次，便于核算单批成本。所有金额只保存在本机数据库中。
      </SectionHint>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="新增账目"
        footer={<><Button onClick={() => setAddOpen(false)}>取消</Button><Button variant="primary" disabled={busy} onClick={createEntry}>{busy ? "保存中…" : "保存账目"}</Button></>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <SelectField label="类型" value={form.entryType} onChange={(e) => {
            const t = e.target.value as LedgerType;
            setForm((f) => ({ ...f, entryType: t, category: CATEGORIES[t][0] }));
          }}><option value="income">收入</option><option value="expense">支出</option></SelectField>
          <SelectField label="分类" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
            {CATEGORIES[form.entryType].map((c) => <option key={c} value={c}>{c}</option>)}
          </SelectField>
          <Field label="金额（元）" type="number" min="0" step="0.01" value={form.amountYuan || ""} onChange={(e) => setForm((f) => ({ ...f, amountYuan: Number(e.target.value) }))} />
          <Field label="发生日期" type="date" value={form.occurredAt} onChange={(e) => setForm((f) => ({ ...f, occurredAt: e.target.value }))} />
          <SelectField label="关联舰礼批次（可选）" value={form.batchId ?? ""} onChange={(e) => setForm((f) => ({ ...f, batchId: e.target.value ? Number(e.target.value) : null }))}>
            <option value="">不关联</option>
            {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </SelectField>
          <Field label="备注（可选）" value={form.note ?? ""} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
        </div>
      </Modal>

      <Modal open={pendingDelete !== null} onClose={() => setPendingDelete(null)} title="删除账目（二次确认）"
        footer={<><Button onClick={() => setPendingDelete(null)}>取消</Button><Button variant="danger" onClick={removeEntry}>确认删除</Button></>}>
        <p className="text-sm leading-relaxed text-muted">将删除「{pendingDelete?.category}」¥ {pendingDelete?.amountYuan.toFixed(2)}，此操作不可撤销；由航海事件归集的账目删除后可再次归集。</p>
      </Modal>
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { Search, UserPlus, LockKeyhole, ShieldCheck, RotateCw, Trash2 } from "lucide-react";
import { Card, Badge, Button, Field, SelectField, SectionHint } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DataTable, type Column } from "@/components/DataTable";
import { FanDetail } from "@/components/FanDetail";
import { FanFormModal } from "@/components/FanFormModal";
import { GuardBadge } from "@/components/GuardBadge";
import { callSafe, ADDRESS_STATUS_TEXT, GUARD_LEVEL_TEXT } from "@/lib/ipc";
import { zodiacFromBirthday } from "@/lib/zodiac";
import { useApp } from "@/lib/appContext";
import type { AddressStatus, FanProfileDto, FanProfileInput, GuardLevel, Paged, ProfileQuery } from "@/types/dto";

export default function Fans() {
  const { refresh, notify } = useApp();
  const [query, setQuery] = useState<ProfileQuery>({ keyword: "", page: 1, pageSize: 10 });
  const [data, setData] = useState<Paged<FanProfileDto> | null>(null);
  const [selected, setSelected] = useState<FanProfileDto | null>(null);
  const [editing, setEditing] = useState<FanProfileDto | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedRows, setSelectedRows] = useState<FanProfileDto[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: result, error } = await callSafe<Paged<FanProfileDto>>("profile_list", query as unknown as Record<string, unknown>);
    setLoading(false);
    if (error || !result) {
      notify({ tone: "error", title: error?.message ?? "档案列表加载失败", detail: error?.action });
      return;
    }
    setData(result);
    setSelectedRows((prev) => prev.map((row) => result.items.find((item) => item.uid === row.uid) ?? row));
  }, [query, notify]);

  useEffect(() => { load().catch((err: unknown) => console.error("档案加载失败：", err)); }, [load]);

  const setQ = (patch: Partial<ProfileQuery>) => {
    setQuery((q) => ({ ...q, ...patch, page: 1 }));
    setSelectedRows([]);
  };

  const submit = async (input: FanProfileInput) => {
    const command = editing ? "profile_update" : "profile_create";
    const args = editing ? { uid: editing.uid, input } : { input };
    const { error } = await callSafe(command, args);
    if (error) { notify({ tone: "error", title: error.message, detail: error.action }); return; }
    notify({ tone: "success", title: editing ? "档案已更新" : "档案已创建", detail: `${input.currentNickname}（${input.uid}）的敏感字段已加密保存` });
    await load();
    await refresh();
  };

  const doDelete = async () => {
    const uids = selectedRows.map((row) => row.uid);
    if (uids.length === 0) return;
    const { data: deleted, error } = await callSafe<number>("profile_delete", { uids, confirm: true });
    if (error) { notify({ tone: "error", title: error.message, detail: error.action }); return; }
    notify({ tone: "success", title: "档案已删除", detail: `共删除 ${deleted ?? uids.length} 位粉丝档案，相关本机数据已一并清理` });
    setSelectedRows([]);
    if (selected && uids.includes(selected.uid)) setSelected(null);
    await load();
    await refresh();
  };

  const deleteNames = selectedRows.slice(0, 5).map((row) => `${row.currentNickname}（${row.uid}）`).join("、");

  const columns: Column<FanProfileDto>[] = [
    { key: "uid", title: "UID", width: "130px", render: (p) => <span className="masked-value text-muted">{p.uid}</span> },
    { key: "nickname", title: "当前昵称", render: (p) => (
      <div className="flex items-center gap-2"><span className="font-medium">{p.currentNickname}</span>
        {p.manualLockedFields.length > 0 && <LockKeyhole size={12} className="text-warning" />}</div>
    ) },
    { key: "level", title: "大航海", width: "130px", render: (p) => {
      const level = p.guardLevel ?? p.lastGuardLevel;
      if (!level) return <span className="text-muted">—</span>;
      return (
        <span className="flex items-center gap-1.5" title={p.guardExpired ? "已退出最新大航海名单" : undefined}>
          <GuardBadge level={level} expired={p.guardExpired} size={22} />
          <span className="text-xs whitespace-nowrap">
            {p.guardExpired
              ? <span className="text-danger font-medium">已过期</span>
              : GUARD_LEVEL_TEXT[level]}
          </span>
        </span>
      );
    } },
    { key: "birthday", title: "生日 / 星座", width: "130px", render: (p) => (
      <div className="flex flex-col leading-tight">
        <span className="masked-value">{p.birthdayMasked ?? "—"}</span>
        <span className="text-xs text-muted mt-0.5">{zodiacFromBirthday(p.birthdayMasked) ?? "星座未登记"}</span>
      </div>
    ) },
    { key: "address", title: "地址（脱敏）", render: (p) => <span className="text-xs masked-value">{p.addressMasked ?? "—"}</span> },
    { key: "status", title: "地址审核", width: "110px", render: (p) => <Badge tone={p.addressStatus === "valid" ? "success" : p.addressStatus === "pending" ? "warning" : "neutral"}>{ADDRESS_STATUS_TEXT[p.addressStatus]}</Badge> },
    { key: "locked", title: "锁定字段", width: "100px", render: (p) => <span className="text-xs text-muted">{p.manualLockedFields.length} 项</span> },
  ];

  return (
    <div className="flex flex-col gap-5">
      <SectionHint tone="neutral">
        <ShieldCheck size={12} className="inline mr-1" />
        档案以 B 站 UID 为唯一主键，昵称作为可变属性并保留变更历史。地址与生日加密存储、默认脱敏；同 UID 重复导入会保留最早首次互动时间与手动锁定字段。误导入的档案可勾选后批量删除，删除需二次确认。
      </SectionHint>

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              className="field pl-9"
              placeholder="搜索 UID 或昵称（含空格、生僻字可精确匹配）"
              value={query.keyword ?? ""}
              onChange={(e) => setQ({ keyword: e.target.value })}
            />
          </div>
          <SelectField label="舰长等级" className="w-[130px]" value={query.guardLevel ?? ""} onChange={(e) => setQ({ guardLevel: e.target.value ? (Number(e.target.value) as GuardLevel) : null })}>
            <option value="">全部等级</option><option value="1">总督</option><option value="2">提督</option><option value="3">舰长</option>
          </SelectField>
          <SelectField label="地址审核" className="w-[140px]" value={query.addressStatus ?? ""} onChange={(e) => setQ({ addressStatus: (e.target.value || null) as AddressStatus | null })}>
            <option value="">全部状态</option>
            {(Object.keys(ADDRESS_STATUS_TEXT) as AddressStatus[]).map((k) => <option key={k} value={k}>{ADDRESS_STATUS_TEXT[k]}</option>)}
          </SelectField>
          <label className="flex items-center gap-2 text-sm pb-2.5 cursor-pointer">
            <input type="checkbox" className="h-4 w-4 cursor-pointer accent-[var(--primary)]" checked={query.onlyLocked ?? false} onChange={(e) => setQ({ onlyLocked: e.target.checked })} />
            仅看手动锁定
          </label>
          <Button className="mb-0.5" onClick={() => load()}><RotateCw size={14} /> 刷新</Button>
          <Button variant="danger" className="mb-0.5" disabled={selectedRows.length === 0} onClick={() => setDeleteOpen(true)}>
            <Trash2 size={14} /> 删除所选{selectedRows.length > 0 ? `（${selectedRows.length}）` : ""}
          </Button>
          <Button variant="primary" className="mb-0.5" onClick={() => { setEditing(null); setFormOpen(true); }}><UserPlus size={14} /> 新建档案</Button>
        </div>
      </Card>

      <Card title="粉丝档案列表" extra={
        <div className="flex items-center gap-2">
          {selectedRows.length > 0 && <Badge tone="danger">已选 {selectedRows.length} 位</Badge>}
          <Badge tone="primary">{data?.total ?? 0} 位粉丝</Badge>
        </div>
      }>
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(p) => p.uid}
          onRowClick={(p) => setSelected(p)}
          selectable
          selectedKeys={selectedRows.map((p) => p.uid)}
          onSelectedKeysChange={(keys) => setSelectedRows((prev) => [
            ...prev.filter((row) => keys.includes(row.uid)),
            ...(data?.items ?? []).filter((row) => keys.includes(row.uid) && !prev.some((p) => p.uid === row.uid)),
          ])}
          emptyTitle={loading ? "正在加载…" : "没有匹配的档案"}
          emptyDesc="调整筛选条件，或新建档案 / 导入名单"
          page={data?.page}
          pageSize={data?.pageSize}
          total={data?.total}
          onPageChange={(page) => setQuery((q) => ({ ...q, page }))}
        />
      </Card>

      {selected && (
        <FanDetail
          profile={selected}
          onClose={() => setSelected(null)}
          onEdit={() => { setEditing(selected); setSelected(null); setFormOpen(true); }}
          onChanged={async () => {
            await load();
            const { data: fresh } = await callSafe<FanProfileDto>("profile_get", { uid: selected.uid });
            setSelected(fresh);
          }}
        />
      )}

      <ConfirmDialog
        open={deleteOpen}
        title="删除粉丝档案"
        description={`即将删除选中的 ${selectedRows.length} 位粉丝档案：${deleteNames}${selectedRows.length > 5 ? " 等" : ""}。`}
        detail="删除会同时清除这些 UID 的昵称历史、纪念日处理标记、在舰名单与事件、舰礼寄送记录；记账本中已归集的收支记录会保留。此操作不可撤销，建议先备份。"
        confirmText="确认删除"
        requireCheck="我已确认上述档案导入有误或不再需要，并了解删除后无法撤销"
        onClose={() => setDeleteOpen(false)}
        onConfirm={doDelete}
      />

      <FanFormModal open={formOpen} profile={editing} onClose={() => setFormOpen(false)} onSubmit={submit} />
    </div>
  );
}

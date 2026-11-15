import { useCallback, useEffect, useState } from "react";
import { Gift, Plus, PackageCheck, Truck, Eye, FileDown, ShieldCheck, UsersRound } from "lucide-react";
import { Badge, Button, Card, EmptyState, Field, Modal, SectionHint, SelectField } from "@/components/ui";
import { DataTable, type Column } from "@/components/DataTable";
import { ADDRESS_STATUS_TEXT, callSafe, formatBytes, SHIPMENT_TEXT } from "@/lib/ipc";
import { useApp } from "@/lib/appContext";
import type {
  AddressDto, AddressStatus, ExportResult, GiftBatchDto, GiftShipmentDto, GuardMemberDto,
  ShipmentStatus,
} from "@/types/dto";

const SHIPMENT_OPTIONS: ShipmentStatus[] = ["pending", "address_missing", "shipped", "invalid_address"];
const ADDRESS_OPTIONS: AddressStatus[] = ["none", "pending", "valid", "invalid", "shipped"];

interface ConfirmState {
  title: string;
  desc: string;
  action: () => Promise<void>;
}

export default function Gifts() {
  const { notify, refresh } = useApp();
  const [batches, setBatches] = useState<GiftBatchDto[]>([]);
  const [members, setMembers] = useState<GuardMemberDto[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [shipments, setShipments] = useState<GiftShipmentDto[]>([]);
  const [draft, setDraft] = useState<Record<number, { shipmentStatus: ShipmentStatus; trackingNo: string }>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [batchName, setBatchName] = useState("");
  const [selectedUids, setSelectedUids] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [address, setAddress] = useState<AddressDto | null>(null);
  const [busy, setBusy] = useState(false);

  const loadBatches = useCallback(async () => {
    const { data, error } = await callSafe<GiftBatchDto[]>("gift_batch_list");
    if (data) {
      setBatches(data);
      setSelectedId((cur) => cur ?? data[0]?.id ?? null);
    }
    if (error) notify({ tone: "error", title: "批次读取失败", detail: error.action });
  }, [notify]);

  const loadShipments = useCallback(async (batchId: number | null) => {
    if (!batchId) { setShipments([]); return; }
    const { data, error } = await callSafe<GiftShipmentDto[]>("gift_shipment_list", { batchId });
    if (data) {
      setShipments(data);
      setDraft(Object.fromEntries(data.map((s) => [s.id, { shipmentStatus: s.shipmentStatus, trackingNo: s.trackingNo ?? "" }])));
    }
    if (error) notify({ tone: "error", title: "寄送清单读取失败", detail: error.action });
  }, [notify]);

  useEffect(() => {
    loadBatches().catch((err: unknown) => console.error("批次加载失败：", err));
    callSafe<{ items: GuardMemberDto[] }>("guard_list").then(({ data }) => { if (data) setMembers(data.items ?? []); }).catch(() => undefined);
  }, [loadBatches]);
  useEffect(() => { loadShipments(selectedId).catch((err: unknown) => console.error("寄送清单加载失败：", err)); }, [selectedId, loadShipments]);

  const openCreate = () => {
    setBatchName("");
    setSelectedUids(members.map((m) => m.uid));
    setCreateOpen(true);
  };

  const createBatch = async () => {
    setBusy(true);
    const { data, error } = await callSafe<GiftBatchDto>("gift_batch_create", { name: batchName, memberUids: selectedUids });
    setBusy(false);
    if (error) { notify({ tone: "error", title: "批次创建失败", detail: error.message }); return; }
    setCreateOpen(false);
    setSelectedId(data?.id ?? null);
    notify({ tone: "success", title: "寄送批次已创建", detail: `共 ${data?.memberCount ?? 0} 人，请逐条核对地址与发货状态。` });
    await loadBatches();
    await refresh();
  };

  const updateDraft = (id: number, patch: Partial<{ shipmentStatus: ShipmentStatus; trackingNo: string }>) => {
    setDraft((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } as { shipmentStatus: ShipmentStatus; trackingNo: string } }));
  };

  const saveShipment = async (item: GiftShipmentDto) => {
    const d = draft[item.id];
    const { error } = await callSafe("gift_shipment_update", {
      id: item.id, shipmentStatus: d?.shipmentStatus ?? item.shipmentStatus, trackingNo: d?.trackingNo ?? "",
    });
    if (error) { notify({ tone: "error", title: "寄送状态保存失败", detail: error.message }); return; }
    notify({ tone: "success", title: "已保存", detail: `${item.nickname} 的寄送状态已更新。` });
    await loadShipments(selectedId);
    await loadBatches();
  };

  const auditAddress = async (item: GiftShipmentDto, status: AddressStatus) => {
    const { error } = await callSafe("gift_address_set_status", { uid: item.uid, addressStatus: status });
    if (error) { notify({ tone: "error", title: "地址审核失败", detail: error.message }); return; }
    await loadShipments(selectedId);
    await loadBatches();
  };

  const reveal = (item: GiftShipmentDto) => setConfirm({
    title: "查看完整地址（二次确认）",
    desc: `即将展示 ${item.nickname} 的完整收货地址，电话仍会打码。该操作不会写入日志、不会联网。`,
    action: async () => {
      const { data, error } = await callSafe<AddressDto | null>("gift_shipment_reveal_address", { id: item.id, confirm: true });
      if (error) { notify({ tone: "error", title: "读取失败", detail: error.action }); return; }
      setAddress(data);
    },
  });

  const exportMasked = () => setConfirm({
    title: "导出脱敏寄送清单",
    desc: "导出内容仅含 UID、昵称、等级、省市区掩码与物流单号，不含收件人、电话与门牌号。",
    action: async () => {
      const { data, error } = await callSafe<ExportResult>("gift_batch_export", { batchId: selectedId, confirm: true });
      if (error) { notify({ tone: "error", title: "导出失败", detail: error.action }); return; }
      notify({ tone: "success", title: "脱敏清单已导出", detail: `已保存到备份目录 · ${data?.path ?? ""} · ${formatBytes(data?.sizeBytes ?? 0)}` });
    },
  });

  const batchCols: Column<GiftBatchDto>[] = [
    { key: "name", title: "批次名称", render: (b) => <span className="font-medium">{b.name}</span> },
    { key: "created", title: "创建时间", width: "180px", render: (b) => <span className="text-xs text-muted">{new Date(b.createdAt).toLocaleDateString("zh-CN")}</span> },
    { key: "members", title: "成员", width: "90px", render: (b) => <Badge tone="neutral">{b.memberCount} 人</Badge> },
    { key: "shipped", title: "已寄送", width: "100px", render: (b) => <Badge tone={b.pendingCount === 0 ? "success" : "warning"}>{b.shippedCount} / {b.memberCount}</Badge> },
    { key: "ready", title: "地址可用", width: "100px", render: (b) => <span className="text-sm text-muted">{b.addressReadyCount} 人</span> },
    { key: "action", title: "操作", width: "110px", render: (b) => <Button className="text-xs" onClick={() => setSelectedId(b.id)}>{selectedId === b.id ? "正在查看" : "查看清单"}</Button> },
  ];

  const current = batches.find((b) => b.id === selectedId);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="flex items-center gap-3"><Gift size={22} className="text-accent" /><div><p className="label-sm">寄送批次</p><p className="text-2xl font-semibold mt-1">{batches.length} 个</p></div></Card>
        <Card className="flex items-center gap-3"><PackageCheck size={22} className="text-success" /><div><p className="label-sm">当前批次已寄送</p><p className="text-2xl font-semibold mt-1">{current?.shippedCount ?? 0} 人</p></div></Card>
        <Card className="flex items-center gap-3"><Truck size={22} className="text-warning" /><div><p className="label-sm">待处理</p><p className="text-2xl font-semibold mt-1">{current?.pendingCount ?? 0} 人</p></div></Card>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={openCreate}><Plus size={14} /> 新建寄送批次</Button>
        <Button onClick={exportMasked} disabled={!selectedId}><FileDown size={14} /> 导出脱敏清单</Button>
        <Button onClick={() => notify({ tone: "info", title: "地址从哪来", detail: "在「粉丝档案」中补录收货地址；完整地址始终加密存储，此处默认只显示省市区。" })}><ShieldCheck size={14} /> 隐私说明</Button>
      </div>

      <Card title="寄送批次" extra={<Badge tone="primary">点击「查看清单」切换</Badge>}>
        <DataTable columns={batchCols} rows={batches} rowKey={(b) => String(b.id)} emptyTitle="还没有寄送批次" emptyDesc="点击「新建寄送批次」，从当前在舰名单中勾选成员" />
      </Card>

      <Card
        title={current ? `寄送清单 · ${current.name}` : "寄送清单"}
        extra={<Badge tone="neutral"><UsersRound size={11} /> {shipments.length} 条</Badge>}
      >
        {shipments.length === 0 && <EmptyState title="该批次暂无寄送记录" desc="新建批次并选择在舰成员后，这里会生成逐条寄送清单。" />}
        <div className="flex flex-col gap-3">
          {shipments.map((s) => (
            <div key={s.id} className="glass-soft rounded-xl p-4 flex flex-col gap-3 row-hover">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{s.nickname}</span>
                <span className="text-xs text-muted masked-value">UID {s.uid}</span>
                <Badge tone={s.shipmentStatus === "shipped" ? "success" : s.shipmentStatus === "address_missing" ? "warning" : "neutral"}>
                  {SHIPMENT_TEXT[s.shipmentStatus]}
                </Badge>
                <span className="text-xs text-muted ml-auto">{s.addressMasked ?? "未登记地址"}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <SelectField label="寄送状态" value={draft[s.id]?.shipmentStatus ?? s.shipmentStatus}
                  onChange={(e) => updateDraft(s.id, { shipmentStatus: e.target.value as ShipmentStatus })}>
                  {SHIPMENT_OPTIONS.map((v) => <option key={v} value={v}>{SHIPMENT_TEXT[v]}</option>)}
                </SelectField>
                <Field label="快递单号" placeholder="可留空" value={draft[s.id]?.trackingNo ?? ""} onChange={(e) => updateDraft(s.id, { trackingNo: e.target.value })} />
                <SelectField label="地址审核" value={s.addressStatus} onChange={(e) => auditAddress(s, e.target.value as AddressStatus)}>
                  {ADDRESS_OPTIONS.map((v) => <option key={v} value={v}>{ADDRESS_STATUS_TEXT[v]}</option>)}
                </SelectField>
                <div className="flex items-end gap-2 pb-1">
                  <Button variant="primary" className="text-xs" onClick={() => saveShipment(s)}>保存</Button>
                  <Button className="text-xs" onClick={() => reveal(s)}><Eye size={13} /> 完整地址</Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <SectionHint tone="warning">
        任何完整地址的展示与导出都需要二次确认；脱敏清单不含收件人、电话与门牌号。地址审核状态会同步回粉丝档案，手动锁定字段始终不被导入覆盖。
      </SectionHint>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="新建寄送批次"
        width="max-w-xl"
        footer={<>
          <Button onClick={() => setCreateOpen(false)}>取消</Button>
          <Button variant="primary" disabled={busy} onClick={createBatch}>{busy ? "创建中…" : "创建批次"}</Button>
        </>}
      >
        <div className="flex flex-col gap-4">
          <Field label="批次名称" placeholder="例如 2026 年 11 月舰礼" value={batchName} onChange={(e) => setBatchName(e.target.value)} />
          <div>
            <p className="label-sm mb-2">选择在舰成员（已全选，共 {members.length} 人，已选 {selectedUids.length} 人）</p>
            <div className="scroll-y max-h-56 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {members.map((m) => (
                <label key={m.uid} className="glass-soft rounded-lg px-3 py-2 flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={selectedUids.includes(m.uid)} onChange={(e) => setSelectedUids((prev) => e.target.checked ? [...prev, m.uid] : prev.filter((u) => u !== m.uid))} />
                  <span className="flex-1 truncate">{m.nickname}</span>
                  <span className="text-xs text-muted">#{m.rank ?? "—"}</span>
                </label>
              ))}
              {members.length === 0 && <p className="text-sm text-muted">暂无在舰名单，请先在「大航海与导入」导入。</p>}
            </div>
          </div>
        </div>
      </Modal>

      <Modal open={confirm !== null} onClose={() => setConfirm(null)} title={confirm?.title ?? ""}
        footer={<>
          <Button onClick={() => setConfirm(null)}>取消</Button>
          <Button variant="primary" onClick={async () => { const action = confirm?.action; setConfirm(null); await action?.(); }}>确认</Button>
        </>}>
        <p className="text-sm leading-relaxed text-muted">{confirm?.desc}</p>
      </Modal>

      <Modal open={address !== null} onClose={() => setAddress(null)} title="完整收货地址（电话已打码）"
        footer={<Button variant="primary" onClick={() => setAddress(null)}>关闭</Button>}>
        {address && <div className="grid grid-cols-2 gap-3 text-sm">
          <Diag label="收件人" value={address.receiver || "—"} />
          <Diag label="电话" value={address.phone || "—"} />
          <Diag label="省 / 市 / 区" value={[address.province, address.city, address.district].filter(Boolean).join(" · ") || "—"} />
          <Diag label="审核状态" value={ADDRESS_STATUS_TEXT[address.addressStatus] ?? address.addressStatus} />
          <div className="col-span-2"><Diag label="详细地址" value={address.detail || "—"} /></div>
        </div>}
      </Modal>
    </div>
  );
}

function Diag({ label, value }: { label: string; value: string }) {
  return <div className="flex flex-col gap-1"><span className="label-sm">{label}</span><span className="font-medium break-all">{value}</span></div>;
}

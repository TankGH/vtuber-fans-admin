import { useRef, useState } from "react";
import { FileSpreadsheet, UploadCloud, AlertTriangle, CheckCircle2, FileText } from "lucide-react";
import { Badge, Button, Card, Field, SelectField, SectionHint } from "@/components/ui";
import { Stepper } from "@/components/Stepper";
import { DataTable, type Column } from "@/components/DataTable";
import { StatusBanner } from "@/components/StatusBanner";
import { callSafe, isNative } from "@/lib/ipc";
import { DEFAULT_MAPPING, suggestMapping, parseDelimited } from "@/lib/importLogic";
import { SAMPLE_CSV } from "@/lib/demoData";
import type { ImportMapping, ImportPreview, ImportResult, ImportRowDto } from "@/types/dto";

const STEPS = ["选择文件", "字段映射", "冲突预览", "确认写入"];
const MAP_FIELDS: Array<[keyof ImportMapping, string]> = [
  ["uid", "UID（必填）"], ["nickname", "昵称（必填）"], ["guardLevel", "大航海等级"],
  ["rank", "排名"], ["firstInteractionAt", "首次互动时间"], ["birthday", "生日"],
  ["address", "地址"], ["note", "备注"],
];

interface FileState {
  name: string;
  content: string;
  path?: string;
  headers: string[];
}

export function ImportWizard({ onFinished }: { onFinished: (result: ImportResult) => void }) {
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<FileState | null>(null);
  const [mapping, setMapping] = useState<ImportMapping>(DEFAULT_MAPPING);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep(0); setFile(null); setPreview(null); setResult(null); setError(null);
    setMapping(DEFAULT_MAPPING);
  };

  const loadText = (name: string, content: string, path?: string) => {
    const { headers } = parseDelimited(content);
    if (headers.length === 0) {
      setError("无法识别表头，请确认文件为 UTF-8 编码的 CSV，或在桌面端使用 xlsx 导入");
      return;
    }
    setFile({ name, content, path, headers });
    setMapping(suggestMapping(headers));
    setError(null);
    setStep(1);
  };

  const pickNative = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({ multiple: false, filters: [{ name: "名单文件", extensions: ["csv", "txt", "xlsx", "tsv"] }] });
    if (!path || typeof path !== "string") return;
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const content = await readTextFile(path);
    loadText(path.split(/[\\/]/).pop() || path, content, path);
  };

  const onPick = async () => {
    setBusy(true);
    if (isNative()) {
      await pickNative().catch((err: unknown) => setError(String(err)));
    } else {
      inputRef.current?.click();
    }
    setBusy(false);
  };

  const onBrowserFile = (f: File | undefined) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => loadText(f.name, String(reader.result ?? ""));
    reader.onerror = () => setError("文件读取失败，请重试");
    reader.readAsText(f, "UTF-8");
  };

  const useSample = () => loadText("fans_sample.csv（内置样例）", SAMPLE_CSV);

  const parsePreview = async () => {
    if (!file) return;
    setBusy(true);
    const { data, error: err } = await callSafe<ImportPreview>("import_parse", {
      filePath: file.path, fileContent: file.content, fileName: file.name,
      kind: "fans", mapping,
    });
    setBusy(false);
    if (err) { setError(`${err.message} · ${err.action}`); return; }
    setPreview(data);
    setError(null);
    setStep(2);
  };

  const commit = async () => {
    if (!file || !preview) return;
    setBusy(true);
    const { data, error: err } = await callSafe<ImportResult>("import_commit", {
      filePath: file.path, fileContent: file.content, fileName: file.name,
      kind: "fans", mapping,
    });
    setBusy(false);
    if (err) { setError(`${err.message} · ${err.action}`); return; }
    if (data) { setResult(data); setStep(3); onFinished(data); }
  };

  const columns: Column<ImportRowDto>[] = [
    { key: "row", title: "行", width: "60px", render: (r) => <span className="text-muted">{r.row}</span> },
    { key: "uid", title: "UID", render: (r) => <span className="masked-value">{r.uid || "—"}</span> },
    { key: "nickname", title: "昵称（原样保留）", render: (r) => <span className="font-medium">{r.nickname || "—"}</span> },
    { key: "action", title: "处理方式", render: (r) => (
      <Badge tone={r.action === "new" ? "success" : r.action === "merge" ? "primary" : r.action === "conflict" ? "warning" : "danger"}>
        {r.action === "new" ? "新建" : r.action === "merge" ? "合并" : r.action === "conflict" ? "冲突" : "跳过"}
      </Badge>
    ) },
    { key: "reason", title: "说明", render: (r) => <span className="text-xs text-muted">{r.reason}</span> },
  ];

  return (
    <Card
      title="名单导入向导"
      extra={<Badge tone="warning"><FileSpreadsheet size={12} /> 本期仅手动导入</Badge>}
    >
      <div className="flex flex-col gap-5">
        <Stepper steps={STEPS} current={step} />
        <SectionHint tone="warning">
          本期不自动抓取 B 站数据。导入通道始终可用：支持 CSV / TSV（浏览器可直接体验），桌面端另支持 .xlsx。昵称含空格、「丶」与生僻字均原样保留，数字形态昵称不会自动当作 UID。
        </SectionHint>

        <input ref={inputRef} type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={(e) => onBrowserFile(e.target.files?.[0])} />

        {step === 0 && (
          <div className="flex flex-col gap-3">
            <div className="glass-soft flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[var(--border)] py-10 text-center">
              <UploadCloud size={30} className="text-accent" />
              <p className="font-medium">选择名单文件开始导入</p>
              <p className="text-xs text-muted max-w-lg leading-relaxed">
                建议表头包含 uid、nickname、guard_level、rank 等列。预览阶段不会写入任何数据，确认后才在单事务内批量写入。
              </p>
              <div className="flex gap-2 mt-2">
                <Button variant="primary" disabled={busy} onClick={onPick}>选择文件</Button>
                <Button onClick={useSample}>使用内置样例</Button>
              </div>
            </div>
            <div className="flex items-start gap-2 text-xs text-muted">
              <FileText size={14} className="mt-0.5 shrink-0" />
              <span>样例文件另见 <code className="text-accent">tests/samples/fans_sample.csv</code>，含「晚 风」「大幕丶渐起」与一条缺少 UID 的错误行。</span>
            </div>
          </div>
        )}

        {step === 1 && file && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted mt-1">识别到 {file.headers.length} 列：{file.headers.join("、")}</p>
              </div>
              <Button onClick={reset}>重新选择</Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {MAP_FIELDS.map(([key, label]) => (
                <SelectField key={key} label={label} value={mapping[key]} onChange={(e) => setMapping({ ...mapping, [key]: e.target.value })}>
                  <option value="">（不导入）</option>
                  {file.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </SelectField>
              ))}
            </div>
            <Field label="快照日期（可选）" placeholder="例如 2026-11-13" hint="用于把本次导入关联到某一天的在舰名单快照" />
            <div className="flex justify-end gap-2">
              <Button onClick={() => setStep(0)}>上一步</Button>
              <Button variant="primary" disabled={!mapping.uid || !mapping.nickname || busy} onClick={parsePreview}>
                {busy ? "解析中…" : "生成合并预览"}
              </Button>
            </div>
          </div>
        )}

        {step === 2 && preview && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                ["总行数", preview.totalRows, "neutral"], ["新建", preview.newCount, "success"],
                ["合并", preview.mergeCount, "primary"], ["冲突 / 跳过", preview.conflictCount + preview.invalidCount, "warning"],
              ].map(([label, value, tone]) => (
                <div key={String(label)} className="glass-soft rounded-xl px-4 py-3">
                  <p className="label-sm">{label}</p>
                  <p className={tone === "success" ? "text-2xl font-semibold text-success mt-1" : tone === "warning" ? "text-2xl font-semibold text-warning mt-1" : "text-2xl font-semibold mt-1"}>{value}</p>
                </div>
              ))}
            </div>
            {preview.conflicts.length > 0 && (
              <div className="flex items-start gap-2 text-xs text-warning">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>{preview.conflicts.slice(0, 3).map((c) => `第 ${c.row} 行：${c.reason}`).join("；")}{preview.conflicts.length > 3 ? " 等" : ""}</span>
              </div>
            )}
            <DataTable columns={columns} rows={preview.rows} rowKey={(r) => `${r.row}-${r.uid}`} emptyTitle="没有可预览的行" emptyDesc="请返回上一步检查文件内容" />
            {preview.truncated && <p className="text-xs text-muted">仅展示前 100 行，写入时仍会处理全部记录。</p>}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setStep(1)}>上一步</Button>
              <Button variant="primary" disabled={busy} onClick={commit}>{busy ? "写入中…" : "确认写入数据库"}</Button>
            </div>
          </div>
        )}

        {step === 3 && result && (
          <div className="flex flex-col gap-4">
            <StatusBanner tone="success" title="导入完成" detail={`新增 ${result.newCount} 条、合并 ${result.mergeCount} 条、跳过 ${result.skippedCount} 条；批次编号 #${result.batchId}`} />
            {result.errors.length > 0 && (
              <SectionHint tone="warning">
                <p className="font-medium mb-1">逐行结果（{result.errors.length} 条提示）</p>
                {result.errors.slice(0, 8).map((e, i) => <p key={i}>· {e}</p>)}
              </SectionHint>
            )}
            <div className="flex justify-end"><Button variant="primary" onClick={reset}>继续导入下一批</Button></div>
          </div>
        )}

        {error && <StatusBanner tone="error" title="导入未完成" detail={error} onClose={() => setError(null)} />}
        {result && step === 3 && (
          <div className="flex items-center gap-2 text-xs text-success"><CheckCircle2 size={14} /> 所有写入均在单事务内完成，失败会整体回滚。</div>
        )}
      </div>
    </Card>
  );
}

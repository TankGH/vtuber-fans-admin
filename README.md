# 守村人·粉丝档案

面向 VTB 主播本人与助理的 **Windows 本地桌面工具**。粉丝档案、地址、生日与消费记录全部保存在用户本机，**没有云端后端、没有遥测**。

> **版本管理**：源码仓库为 [`TankGH/vtuber-fans-admin`](https://github.com/TankGH/vtuber-fans-admin.git)；粉丝数据、主密钥与备份文件始终只保存在用户本机，不入库、不上传。
>
> **权威需求来源**：[`requirement-doc.md`](./requirement-doc.md)（v0.1 规划稿）。实现层说明见 [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) / [`docs/DESIGN.md`](./docs/DESIGN.md) / [`docs/ROADMAP.md`](./docs/ROADMAP.md)；**安装部署与日常操作**见 [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md)。

## 当前范围（v0.2.0）

| 功能域 | 状态 | 说明 |
| --- | --- | --- |
| F1 粉丝终身档案 | ✅ 可用 | UID 主键、昵称历史、手动锁定字段、同 UID 合并、敏感字段加密与脱敏；生日推算星座、总督/提督/舰长徽章图标，退出最新名单的成员标注「已过期」 |
| F2 大航海名单 | ✅ 可用 | CSV / Excel 手动导入、字段映射、冲突预览、快照与事件、有效期核算；另提供用户可选启用的网页端名单快照 |
| F3 纪念日提醒 | ✅ 可用 | 生日 / 上舰周年 / 观看纪念日按年度循环计算、汇总卡片、Windows 原生 Toast、祝福话术复制与处理标记 |
| F4 舰礼寄送台账 | ✅ 可用 | 寄送批次、地址审核流转、逐条发货状态与快递单号、完整地址二次确认、脱敏清单导出 |
| F5 主播记账本 | ✅ 可用 | 手动收支、大航海事件幂等归集、月度趋势图、支出关联寄送批次 |
| F6 备份与恢复 | ✅ 可用 | 启动自动备份、最近 7 份滚动、一键恢复向导、加密库与脱敏 CSV 导出 |
| F7 设置与主题 | ✅ 可用 | 三套主题即时切换、备份目录、托盘行为、**自动抓取开关与按需扫码登录** |

> **当前不建议使用扫码自动获取（尚未验证）**：真实 B 站账号的扫码登录与名单拉取还没有做过人工端到端验证，接口可能变更、返回空名单，或把当日大航海快照写空。正式名单请使用 CSV / Excel 手动导入；如仍需试用，请先做一次备份、使用主播本人（或有该直播间管理权限）的账号，并在同步后自行核对名单。设置页、启用确认框与扫码弹窗均已放置同样提示。
>
> **自动抓取由用户决定**：默认关闭，关闭时应用不会发起任何外部请求。用户主动开启并二次确认后，还需要在设置页点击「扫码登录 B 站」按需完成登录，凭证以本机密钥加密保存；此后才可「立即同步一次」或按设定时刻执行每日快照。同步失败会显示中文原因并建议重新扫码、检查网络或改用手动导入。手动导入始终是可用的正式通道，见 [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) §4.6。
>
> 当前实现为网页端低频快照，不含直播间 WebSocket 实时事件订阅；后续演进见 `docs/ROADMAP.md`。

## 安全边界

| 边界 | 规则 |
| --- | --- |
| 网络 | 默认**零外联**。仅在用户启用自动抓取后，扫码登录 / 登录态校验 / 名单快照会访问 B 站网页接口（尚未验证，当前不建议使用）；粉丝数据只写入本地 SQLite，不上传任何服务端 |
| 敏感字段 | 地址、生日、B 站登录凭证以 AES-256-GCM 密文落盘，主密钥由 Windows DPAPI（CurrentUser）保护 |
| 默认视图 | 地址仅显示「省+市+区」，生日仅显示「月日」；完整地址需二次确认 |
| 导出 | 默认脱敏 CSV；导出加密库文件 / 完整地址必须二次确认 |
| 日志 | 只记录错误码、操作类型与行数，绝不写入 Cookie、收件人、电话、完整地址、生日或主密钥 |
| 恢复 | 恢复前自动为当前库再备份一次，任何恢复都可回退 |

> **与需求文档的可审计偏差**：需求文档 3.3 指定 SQLCipher 全库加密。Windows/MSVC 下 `bundled-sqlcipher-vendored-openssl` 需要 Perl / NASM / OpenSSL 源码编译链，当前采用「SQLite + 字段级 AES-256-GCM + DPAPI 主密钥 + 备份整体加密」的降级方案。详见 `docs/ARCHITECTURE.md` §4.1 与 `docs/ROADMAP.md` 后续阶段三（迁移回全库加密的路径）。**未静默降低安全性**：敏感字段仍是密文，数据仍不出本机。

## 目录

```
vtuber-fans-admin/
├── requirement-doc.md         [保留] 原始需求与架构文档（唯一需求依据）
├── requirement.md             [保留] 原始素材
├── docs/                      架构 / 详细设计 / 演进路线 / 部署与使用指南
├── src/                       React + TS 前端（页面 / 组件 / IPC 契约 / 主题）
├── src-tauri/                 Rust Core（Commands / 领域服务 / schema / 加密 / 备份）
├── scripts/                   Windows 一键打包脚本（自动加载 MSVC 环境）
├── release/                   预构建产物（免安装 exe 与 NSIS 安装包）
├── tests/samples/             CSV / xlsx 导入样例
├── tests/verification/        本地 UI 验证截图与快照（不入库）
├── index.html / vite.config.ts / tailwind.config.ts / tsconfig*.json
└── package.json
```

## 本地开发

> 面向使用者的安装、首启、导入、备份、升级与排障流程见 [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md)；本节只保留开发者速查。

### 前置工具链（Windows）

| 依赖 | 说明 |
| --- | --- |
| Node.js ≥ 20（本机 24.14.0 / npm 11.9.0） | 前端构建 |
| Rust stable `x86_64-pc-windows-msvc` | `rustup-init.exe -y --default-toolchain stable --profile minimal --default-host x86_64-pc-windows-msvc` |
| Visual Studio Build Tools 2022 | 勾选「C++ 生成工具」+ Windows SDK，提供 `cl.exe` / `link.exe` |
| WebView2 Runtime | Windows 11 / 已装 Edge 通常自带 |

验证：`npm run typecheck`、`cargo --version`、`rustc --version`。

> **MSVC 环境提示**：`rustup` 安装后，新开的终端需把 `%USERPROFILE%\.cargo\bin` 加入 PATH；运行 `cargo check` / `cargo test` 前还需加载 VS Build Tools 的 `vcvars64.bat`（默认位于 `C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\`），为 `link.exe` 与 Windows SDK 库提供环境变量。

### 命令

```powershell
npm install                 # 安装前端依赖
npm run dev                 # 仅前端（Vite dev server + 演示数据适配器）
npm run build               # tsc --noEmit && vite build
npm run test                # Vitest 前端单测
npm run tauri:dev           # 完整桌面应用（需 Rust 工具链）
npm run tauri:build         # 打包 NSIS 安装包（.exe）
```

Rust 侧（MSVC 环境内）：`cd src-tauri; cargo check; cargo test`。

### 数据目录

| 内容 | 默认位置 |
| --- | --- |
| 数据目录 | `%APPDATA%\com.vtuber.fans.admin`（由 Tauri `app_data_dir()` 解析，界面状态栏 / 设置页显示实际路径） |
| 数据库 | 数据目录下 `fans.db` |
| 主密钥 | 数据目录下 `app.key`（Windows DPAPI CurrentUser 保护） |
| 配置 | 数据目录下 `settings.json` |
| B 站凭证 | 数据目录下 `bili_session.enc`（仅用户扫码登录后生成，DPAPI 主密钥加密；不进备份清单） |
| 备份 | 首启引导中由用户选择，默认 `%USERPROFILE%\Documents\vtuber-fans-admin-backups` |
| 恢复标记 | 数据目录下 `restore.json` |

> 所有上述文件都不进入 git（见 `.gitignore`）。请勿手动编辑或删除 `app.key`：它绑定当前 Windows 用户，丢失后密文敏感字段无法解密；换机与重装系统的限制见 [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) §5.3。

## 使用流程

1. 首次启动：两步引导（选择备份目录 → 完成），随后自动创建数据库与首个备份。
2. 「粉丝档案」：新建档案、编辑备注、开关字段锁定、查看昵称变更历史；列表与详情显示由生日推算的星座和大航海等级徽章（总督 / 提督 / 舰长，图片随程序打包），退出最新名单的成员显示灰化徽章与「已过期」；敏感段默认折叠。
3. 「大航海与导入」：选择 CSV / xlsx → 字段映射 → 预览新增/合并/冲突 → 确认写入 → 查看逐行结果。
4. 「纪念日提醒」：按提前天数汇总未来节点，复制祝福话术、标记已处理；顶栏角标显示待处理数量，首次启动推送一次 Windows Toast。
5. 「舰礼寄送台账」：新建批次并勾选在舰成员 → 逐条审核地址、登记寄送状态与快递单号 → 导出脱敏清单；完整地址需二次确认且电话打码。
6. 「主播记账本」：手动记收支、一键归集大航海事件收入（同一事件不重复计入）、查看月度趋势与净额。
7. 「备份恢复」：查看 7 份滚动备份、立即备份、一键恢复、导出脱敏 CSV 或加密库。
8. 「系统设置」：切换主题、更换备份目录、配置关窗行为；如需自动抓取，主动开启开关并二次确认 → 填写房间号与每日快照时刻 → 按需扫码登录 → 立即同步一次。

导入样例见 `tests/samples/`：昵称含空格、`丶` 顿号变体、生僻字与纯数字形态均原样保留，**数字形态昵称不会自动被当作 UID**。

## 验证结果

> 严格区分「前端浏览器演示模式已验证」与「Tauri 原生端已编译验证」。未做实机验证的部分在文末明确列出，**不伪造编译通过**。验证日期：2026-11-14（v0.2.0）。

### 工具链（实测）

| 项 | 结果 |
| --- | --- |
| Rust / cargo | `1.100.0`，目标 `x86_64-pc-windows-msvc` |
| MSVC | VS Build Tools 2022，`cl.exe 19.44` + Windows SDK |
| Node / npm | `v24.14.0` / `11.9.0` |
| WebView2 Runtime | 已安装 |
| 依赖 | `npm install` 成功；`cargo check` 完成全部依赖编译 |

### 自动化结果

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| TypeScript strict + 生产构建 | `npm run build` | ✅ 通过，产物 `dist/`；三张徽章 PNG 已随包输出，仅 recharts 单 chunk 体积提示（非错误） |
| 前端单测 | `npm run test` | ✅ **29** 个用例全通过（导入解析、错误码映射、演示适配器、同步开关与扫码、提醒、舰礼、记账、星座边界） |
| Rust 编译检查 | `cargo check` | ✅ 通过（dev / release profile） |
| Rust 单测 | `cargo test` | ✅ **21** 个用例全通过：既有 19 项 + 记账创建后回读（实测报告 P1 回归）+ 过期成员保留历史等级 |
| 前端 UI | `npm run dev` + Playwright CLI | ✅ 通过，明细见下 |
| Tauri release 打包 | `npm run tauri:build` | ✅ 通过（2026-11-14，`EXIT=0`），产出 NSIS 安装包与免安装 exe（大小与 SHA-256 见文末） |

### UI 验证明细（1600×1000 → 1100×900，浏览器演示模式）

| 场景 | 结果 |
| --- | --- |
| 首启引导 | 选择备份目录 → 完成引导 → 进入概览；引导文案明确「扫码自动获取尚未验证、当前不建议使用」 |
| 概览 P1 | 4 张统计卡、备份健康、近期动态、快捷操作、业务台账导览（已可用）、底部状态栏；同步区块以警示色标出「尚未验证」 |
| 档案 F1 | 13 条分页表格；「大航海」列显示随包打包的总督 / 提督 / 舰长徽章图片；「生日 / 星座」列由脱敏生日推算星座（`11-15` → 天蝎座、`12-02` → 射手座，未登记显示「星座未登记」）；第 2 页「大幕丶渐起」显示灰化舰长徽章与「已过期」，详情侧滑同步显示星座与过期徽章 |
| 导入 F2 | 上传 `tests/samples/fans_sample.csv` → 10 列自动映射 → 预览 14 行 → 确认写入 → 逐行提示；横幅说明手动导入与可选同步复用同一套合并状态机 |
| 纪念日 F3 | 汇总卡片（待处理 4 / 今天 1）、提前天数下拉、已处理开关；标记「已处理」后顶栏角标 4 → 3 且提示条正确 |
| 舰礼台账 F4 | 2 个批次表格 + 5 条寄送清单；新建「UI 冒烟批次」并全选 13 位在舰成员 → 批次创建成功、清单自动切换；「完整地址」需二次确认，确认后电话显示 `138****6621` |
| 记账本 F5 | 按需加载成功，总收入 / 总支出 / 净额、月度趋势图、账目明细与「归集大航海收入」均渲染；实测手动新增 ¥45.50 支出 → 提示「账目已记录」、弹窗关闭、明细与统计即时刷新、**无「未找到该账目」误报** |
| 设置 F7 · 同步 | 默认关闭且 4 个按钮禁用；卡片顶部醒目红色警示「当前不建议使用扫码自动获取：此功能尚未验证」，标题旁有「尚未验证 · 暂不建议使用」标记；启用二次确认框与扫码弹窗均含同款提示与「建议使用主播本人账号」说明 |
| 响应式 | 1100×900 时侧栏实测 68px 折叠；1600px 恢复 228px |
| 控制台 | `Errors: 0, Warnings: 0`（仅 React DevTools info） |

界面验证明细见上表；可访问性快照为本地验证产物，存放于 `tests/verification/ui-v02b/`，不纳入版本库。

### 界面与配置复核

页面标题、顶栏品牌、面包屑、首启引导标题、主题预览卡、动态时间线与状态栏数据目录均已复核；控制台 `Errors 0 / Warnings 0`。最终复跑 `npm run build`、`npm run test`（29 通过）、`cargo check`、`cargo test`（21 通过）均通过。

> **实测报告 P1 已修复**：`tests/out/守村人粉丝档案-v0.2测试报告.html` 记录「F5 新增账目保存后误报『未找到该账目』但数据已入库」。根因是 `ledger.rs` 在 `log_activity` 写入 `activity_log` 之后才调用 `db.conn.last_insert_rowid()`，拿到的是活动日志的 rowid 而非账目 id。现已在 `INSERT` 后立即捕获 id，并补充回归单测（预热 12 条活动日志以复现触发条件）+ 前端保存重入锁，避免连点产生重复账目。

> 复核过程中本机 Rust `rust-std` 组件曾缺少 `libcore-*.rmeta`，导致 `rustc` 无法解析标准库；已通过重装 `stable-x86_64-pc-windows-msvc` 工具链修复并复验通过。该问题与项目源码无关；换机后若遇到同样报错，执行 `rustup toolchain uninstall stable-x86_64-pc-windows-msvc` 再 `rustup toolchain install stable-x86_64-pc-windows-msvc --profile minimal` 即可。

### 尚未验证的范围（如实说明）

- UI 自动化验证运行于 **Vite dev server + 浏览器演示数据适配器**，不是 Tauri 原生窗口；演示数据只存在于浏览器本地，不是生产数据通道。演示适配器不会访问任何外部服务。
- **打包已完成（v0.2.0 修订版，2026-11-14）**：`npm run tauri:build` 成功生成 `release/守村人·粉丝档案_0.2.0_x64-setup.exe`（4,677,853 字节，SHA-256 `989B032C75CBDC5D3EA24EF2A3030B6FAF4C5FC97D0EB8DA4ED7C1158C1141A2`）与免安装 `release/vtuber-fans-admin.exe`（18,547,712 字节，SHA-256 `BDC9A2DCE213DE27ABB4FA0A814DBD7383F51E90B19B76906AB85DA16FC884BA`）。**双击 exe 即可启动**，双击 setup.exe 安装后从开始菜单启动。两个文件随仓库分发；本地重新构建时输出到 `src-tauri/target/release/`。
- 原生 exe 冒烟测试通过：窗口标题「守村人·粉丝档案」、进程 `Responding=True`、`%APPDATA%\com.vtuber.fans.admin` 下生成 `fans.db` / `app.key` / `settings.json`。
- **真实 B 站账号的扫码登录与名单拉取未做人工端到端验证**（需要账号、网络与接口可用性），**因此当前不建议使用扫码自动获取**；二维码生成、WBI 签名、名单解析与 Cookie 提取已有单测覆盖，但接口变更或返回空名单时可能把当日快照写空。正式名单请使用手动导入。
- **安装向导、托盘最小化、原生 Toast、恢复重启与 DPAPI 解密仍未做人工端到端验证**，`npm run tauri:dev` 未执行；请按 [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) §2.3 清单补齐。
- 当前只打 NSIS：WiX 3 使用代码页 1252，中文产品名触发 `LGHT0311`，因此 `bundle.targets` 设为 `["nsis"]`；如需 MSI，需自定义 WiX 本地化（代码页 936）或改用 ASCII 产品名。
- 后续步骤：在干净的 Windows 机器双击安装包 → 完成两步首启引导 → 核对 `%APPDATA%\com.vtuber.fans.admin\`（`fans.db` / `app.key` / `settings.json`）与备份目录的加密备份及 `manifest.json` → 用 CSV / Excel 手动导入正式名单 → 按 §2.3 逐项验收。**扫码自动获取未验证，不建议纳入正式验收流程**。

## 失败降级路径

| 情况 | 处理 |
| --- | --- |
| `cl.exe` / `link.exe` 缺失 | 安装 VS Build Tools 2022（C++ 生成工具 + Windows SDK）；安装期间可用 `npm run dev` 独立验证前端 |
| 无管理员权限导致安装失败 | 请以管理员身份运行安装器；代码与文档不依赖该权限即可审阅 |
| OpenSSL / Perl / NASM 缺失 | 当前未启用 SQLCipher（见 §安全边界），不影响 `cargo check` |
| 备份目录不可写 | 界面提示「备份目录不可写，请重新选择目录」，已有数据不受影响 |
| 恢复校验失败 | 保留当前库与自动备份，界面提示选择其它备份，不改动现有数据 |

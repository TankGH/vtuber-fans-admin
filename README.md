# 守村人·粉丝档案

面向 VTB 主播本人与助理的 **Windows 本地桌面工具**。粉丝档案、地址、生日与消费记录全部保存在用户本机，**没有云端后端、没有遥测**。

> **版本管理**：源码仓库为 [`TankGH/vtuber-fans-admin`](https://github.com/TankGH/vtuber-fans-admin.git)；粉丝数据、主密钥与备份文件始终只保存在用户本机，不入库、不上传。
>
> **权威需求来源**：[`requirement-doc.md`](./requirement-doc.md)（v0.1 规划稿）。实现层说明见 [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) / [`docs/DESIGN.md`](./docs/DESIGN.md) / [`docs/ROADMAP.md`](./docs/ROADMAP.md)；**安装部署与日常操作**见 [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md)。

## 本期范围（核心 MVP）

| 功能域 | 状态 | 说明 |
| --- | --- | --- |
| F1 粉丝终身档案 | ✅ 可用 | UID 主键、昵称历史、手动锁定字段、同 UID 合并、敏感字段加密与脱敏 |
| F2 大航海名单 | ✅ 部分 | CSV / Excel 导入、字段映射、冲突预览、快照与事件数据结构、有效期核算；**本期不自动抓取 B 站数据** |
| F3 纪念日提醒 | ⏸ 占位 | 表结构与接口已预留 |
| F4 舰礼寄送台账 | ⏸ 占位 | 表结构与接口已预留 |
| F5 主播记账本 | ⏸ 占位 | 表结构与接口已预留 |
| F6 备份与恢复 | ✅ 可用 | 启动自动备份、最近 7 份滚动、一键恢复向导、加密库与脱敏 CSV 导出 |
| F7 设置与主题 | ✅ 可用 | 三套主题即时切换、备份目录、托盘行为；同步配置项为禁用态占位 |

> **能力边界（重要）**：本期同步能力**仅手动导入**，不含 HTTP 快照、WebSocket、WBI 签名、扫码登录与 Cookie 管理。设置页中相关控件统一置为禁用态并标注「待同步引擎启用」，避免造成已可用的错觉。手动导入是永不关闭的底座，后续接入步骤见 `docs/ROADMAP.md`。

## 安全边界

| 边界 | 规则 |
| --- | --- |
| 网络 | 本期**零外联**；所有数据只在本地 SQLite 与本地备份目录之间流动 |
| 敏感字段 | 地址、生日、Cookie 等以 AES-256-GCM 密文落盘，主密钥由 Windows DPAPI（CurrentUser）保护 |
| 默认视图 | 地址仅显示「省+市+区」，生日仅显示「月日」；完整地址需二次确认 |
| 导出 | 默认脱敏 CSV；导出加密库文件 / 完整地址必须二次确认 |
| 日志 | 只记录错误码、操作类型与行数，绝不写入 Cookie、收件人、电话、完整地址、生日或主密钥 |
| 恢复 | 恢复前自动为当前库再备份一次，任何恢复都可回退 |

> **与需求文档的可审计偏差**：需求文档 3.3 指定 SQLCipher 全库加密。Windows/MSVC 下 `bundled-sqlcipher-vendored-openssl` 需要 Perl / NASM / OpenSSL 源码编译链，本期采用「SQLite + 字段级 AES-256-GCM + DPAPI 主密钥 + 备份整体加密」的降级方案。详见 `docs/ARCHITECTURE.md` §4.1 与 `docs/ROADMAP.md` 阶段七（迁移回全库加密的路径）。**未静默降低安全性**：敏感字段仍是密文，数据仍不出本机。

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
| 备份 | 首启引导中由用户选择，默认 `%USERPROFILE%\Documents\vtuber-fans-admin-backups` |
| 恢复标记 | 数据目录下 `restore.json` |

> 所有上述文件都不进入 git（见 `.gitignore`）。请勿手动编辑或删除 `app.key`：它绑定当前 Windows 用户，丢失后密文敏感字段无法解密；换机与重装系统的限制见 [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) §5.3。

## 使用流程

1. 首次启动：两步引导（选择备份目录 → 完成），随后自动创建数据库与首个备份。
2. 「粉丝档案」：新建档案、编辑备注、开关字段锁定、查看昵称变更历史；敏感段默认折叠。
3. 「大航海与导入」：选择 CSV / xlsx → 字段映射 → 预览新增/合并/冲突 → 确认写入 → 查看逐行结果。
4. 「备份恢复」：查看 7 份滚动备份、立即备份、一键恢复、导出脱敏 CSV 或加密库。
5. 「系统设置」：切换三套主题、更换备份目录、配置关窗行为、查看诊断信息。

导入样例见 `tests/samples/`：昵称含空格、`丶` 顿号变体、生僻字与纯数字形态均原样保留，**数字形态昵称不会自动被当作 UID**。

## 验证结果

> 严格区分「前端浏览器演示模式已验证」与「Tauri 原生端已编译验证」。未做实机验证的部分在文末明确列出，**不伪造编译通过**。验证日期：2026-11-13。

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
| TypeScript strict + 生产构建 | `npm run build` | ✅ 通过，产物 `dist/`；仅有 `>500 kB` 单 chunk 体积提示（recharts 与图标库，非错误） |
| 前端单测 | `npm run test` | ✅ 3 个文件 / **20** 个用例全通过（导入解析、错误码映射、演示适配器） |
| Rust 编译检查 | `cargo check` | ✅ 通过（dev profile） |
| Rust 单测 | `cargo test` | ✅ **10** 个用例全通过（AES-GCM 加解密与篡改检测、字段脱敏、CSV/XLSX 解析、字段映射、导入预览分类、合并保留最早互动与锁定昵称、7 份滚动备份、错误码覆盖、脱敏 CSV 不含完整地址） |
| 前端 UI | `npm run dev` + Playwright CLI | ✅ 通过，明细见下 |
| Tauri release 打包 | `npm run tauri:build` | ✅ 通过（2026-11-14，`BUILD_EXIT_CODE=0`），产出 NSIS 安装包 3.75 MiB 与免安装 exe 15.0 MiB |

### UI 验证明细（1600×1000，浏览器演示模式）

| 场景 | 结果 |
| --- | --- |
| 首启引导 | 选择备份目录 → 完成引导 → 进入概览 |
| 概览 P1 | 4 张统计卡、备份健康、近期动态、快捷操作、后续能力导览、底部状态栏 |
| 档案 F1 | 13 条分页表格；「晚 风」「廾匸」「大幕丶渐起」等昵称原样保留；生日/地址默认脱敏；精确搜索「晚 风」命中 1 条；详情侧滑含曾用名与锁定字段；完整地址需勾选二次确认，展示后电话仍打码；新建档案保存成功（13 → 14 人） |
| 导入 F2 | 上传 `tests/samples/fans_sample.csv` → 10 列自动映射 → 预览 14 行（12 合并 / 1 锁定字段冲突 / 1 缺 UID 跳过）→ 确认写入（新增 0 / 合并 13 / 跳过 1，批次 #7）→ 逐行提示；能力边界横幅明确零抓取 |
| 备份 F6 | 3 份滚动列表与记录数摘要；立即备份后 3 → 4 份；恢复二次确认后提示「恢复已准备就绪」及安全备份编号；导出加密库二次确认可取消 |
| 设置 F7 | 三套主题即时切换，根元素 `data-theme` 依次为 `galaxy` / `mist` / `aurora`；Cookie / 快照时刻 / WS 三项禁用并标注「待同步引擎启用」 |
| 占位 F3–F5 | 三个页面均展示规划能力与已就绪表结构，明确本期不产生业务数据 |
| 响应式 | 1100×900 时侧栏折叠为 68px 图标条且主区同步偏移；1600px 恢复 228px |
| 控制台 | `Errors: 0, Warnings: 0`（仅 React DevTools info） |

界面验证明细见上表；截图与可访问性快照为本地验证产物，存放于 `tests/verification/`，不纳入版本库。

### 界面与配置复核

页面标题、顶栏品牌、面包屑、首启引导标题、主题预览卡、动态时间线与状态栏数据目录均已复核；控制台 `Errors 0 / Warnings 0`。复跑 `npm run build`、`npm run test`（20 通过）、`cargo check`、`cargo test`（10 通过）均通过。

> 复核过程中本机 Rust `rust-std` 组件曾缺少 `libcore-*.rmeta`，导致 `rustc` 无法解析标准库；已通过重装 `stable-x86_64-pc-windows-msvc` 工具链修复并复验通过。该问题与项目源码无关；换机后若遇到同样报错，执行 `rustup toolchain uninstall stable-x86_64-pc-windows-msvc` 再 `rustup toolchain install stable-x86_64-pc-windows-msvc --profile minimal` 即可。

### 尚未验证的范围（如实说明）

- UI 自动化验证运行于 **Vite dev server + 浏览器演示数据适配器**，不是 Tauri 原生窗口；演示数据只存在于浏览器本地，不是生产数据通道。
- **打包已完成（2026-11-14）**：`npm run tauri:build` 成功生成 `src-tauri/target/release/bundle/nsis/守村人·粉丝档案_0.1.0_x64-setup.exe`（3,934,261 字节，SHA-256 `15E5F0EF2734EEDEA6A83A9F3050989A63CC142922A9DFA8A1F52EBA52465AC3`）与免安装 `src-tauri/target/release/vtuber-fans-admin.exe`（15,732,224 字节）。**双击 exe 即可启动**，双击 setup.exe 安装后从开始菜单启动。两个文件已复制到 `release/` 随仓库分发；本地重新构建时仍输出到 `src-tauri/target/release/`。
- 原生 exe 冒烟测试通过：窗口标题「守村人·粉丝档案」、进程响应正常、`%APPDATA%\com.vtuber.fans.admin` 下生成 `fans.db` / `app.key`。但**安装向导、托盘最小化、原生 Toast、恢复重启与 DPAPI 解密仍未做人工端到端验证**，`npm run tauri:dev` 未执行；请按 [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) §2.3 清单补齐。
- 本期只打 NSIS：WiX 3 使用代码页 1252，中文产品名触发 `LGHT0311`，因此 `bundle.targets` 设为 `["nsis"]`；如需 MSI，需自定义 WiX 本地化（代码页 936）或改用 ASCII 产品名。
- 后续步骤：在干净的 Windows 机器双击安装包 → 完成两步首启引导 → 核对 `%APPDATA%\com.vtuber.fans.admin\`（`fans.db` / `app.key` / `settings.json`）与备份目录的加密备份及 `manifest.json` → 按 §2.3 逐项验收。

## 失败降级路径

| 情况 | 处理 |
| --- | --- |
| `cl.exe` / `link.exe` 缺失 | 安装 VS Build Tools 2022（C++ 生成工具 + Windows SDK）；安装期间可用 `npm run dev` 独立验证前端 |
| 无管理员权限导致安装失败 | 请以管理员身份运行安装器；代码与文档不依赖该权限即可审阅 |
| OpenSSL / Perl / NASM 缺失 | 本期不启用 SQLCipher（见 §安全边界），不影响 `cargo check` |
| 备份目录不可写 | 界面提示「备份目录不可写，请重新选择目录」，已有数据不受影响 |
| 恢复校验失败 | 保留当前库与自动备份，界面提示选择其它备份，不改动现有数据 |

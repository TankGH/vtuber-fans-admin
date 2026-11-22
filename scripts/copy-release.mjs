import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const releaseDir = join(root, "release");
const targetDir = join(root, "src-tauri", "target", "release");
const nsisDir = join(targetDir, "bundle", "nsis");

const { version } = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const expectedName = `${version}_x64-setup.exe`;
const installers = readdirSync(nsisDir).filter((name) => name.endsWith("-setup.exe"));
const installer = installers.find((name) => name.endsWith(expectedName))
  ?? installers.sort((a, b) => statSync(join(nsisDir, b)).mtimeMs - statSync(join(nsisDir, a)).mtimeMs)[0];
if (!installer) throw new Error("未找到 NSIS 安装包，请先执行 tauri build");

mkdirSync(releaseDir, { recursive: true });
const exe = join(targetDir, "vtuber-fans-admin.exe");
try {
  copyFileSync(exe, join(releaseDir, basename(exe)));
  copyFileSync(join(nsisDir, installer), join(releaseDir, installer));
} catch (error) {
  if (error?.code === "EBUSY" || error?.code === "EPERM") {
    console.error("[错误] release 目录中的 exe 正在运行，请先关闭应用后重新执行 npm run tauri:build");
    process.exit(1);
  }
  throw error;
}

for (const name of readdirSync(releaseDir)) {
  if (name.endsWith("-setup.exe") && name !== installer) {
    rmSync(join(releaseDir, name));
  }
}

console.log(`已复制到 release/${basename(exe)}`);
console.log(`已复制到 release/${installer}`);

@echo off
setlocal
cd /d "%~dp0.."

echo ==== 守村人·粉丝档案 · Windows 打包 ====
echo.

set "VCVARS=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if not exist "%VCVARS%" (
  echo [错误] 未找到 VS Build Tools 2022 的 vcvars64.bat
  echo 请安装「C++ 生成工具 + Windows SDK」后重试，或修改本脚本中的 VCVARS 路径。
  pause
  exit /b 1
)
call "%VCVARS%" >nul

set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
where cargo >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 cargo，请确认已安装 Rust stable x86_64-pc-windows-msvc。
  pause
  exit /b 1
)

echo [1/2] 检查前端依赖...
if not exist "node_modules" call npm install
if errorlevel 1 goto fail

echo [2/2] 构建前端并打包 NSIS 安装包（首次约 5-15 分钟，需联网下载打包工具）...
call npm run tauri:build
if errorlevel 1 goto fail

echo.
echo ==== 打包完成 ====
echo 免安装可执行文件: release\vtuber-fans-admin.exe
echo NSIS 安装包      : release\守村人·粉丝档案_0.3.0_x64-setup.exe
echo 双击 exe 即可启动（需要 WebView2 Runtime）；首次启动会要求选择备份目录。
pause
exit /b 0

:fail
echo.
echo [失败] 打包未完成，请根据上方错误信息处理。详见 docs\DEPLOYMENT.md 第 6 节。
pause
exit /b 1

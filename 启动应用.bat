@echo off
:: 临时从 PATH 中移除 Git usr/bin（含有冲突的 link.exe），然后启动 tauri dev
:: 此操作仅影响本窗口的环境变量，不修改系统设置

set "PATH=%PATH:C:\Program Files\Git\usr\bin;=%"
set "PATH=%PATH:C:\Program Files\Git\usr\bin=%"

cd /d "%~dp0app"
echo [启动] 已临时移除 Git usr/bin，避免 link.exe 冲突
echo [启动] 正在运行 npm run tauri:dev ...
npm run tauri:dev

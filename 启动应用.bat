@echo off
chcp 65001 >nul
setlocal
title 多 Agent 协同工具 - 启动应用
cd /d "%~dp0"

REM 临时从 PATH 中移除 Git 的 usr\bin(含冲突的 link.exe),仅影响本窗口,不改系统设置
set "PATH=%PATH:C:\Program Files\Git\usr\bin;=%"
set "PATH=%PATH:C:\Program Files\Git\usr\bin=%"

echo [启动] 正在运行 npm run tauri:dev ...
echo   首次启动需编译 Rust,可能耗时数分钟,请耐心等待。
echo.

cd /d "%~dp0app"
call npm run tauri:dev

echo.
if errorlevel 1 (
    echo ==================================================
    echo   [失败] 启动异常退出(错误码 %ERRORLEVEL%),请检查上方日志。
    echo   若为首次运行,请先双击 环境配置器.bat 配置好环境。
    echo ==================================================
) else (
    echo [提示] 开发服务已结束。
)
echo.
pause

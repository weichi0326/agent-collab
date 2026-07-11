@echo off
chcp 65001 >nul
setlocal
title 多 Agent 协同工具 - 启动应用
cd /d "%~dp0"

rem Prefer project-local runtimes installed by 环境配置器.bat.
if exist "%~dp0.devtools\node\node.exe" set "PATH=%~dp0.devtools\node;%PATH%"
if exist "%USERPROFILE%\.cargo\bin\cargo.exe" set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

rem Temporarily remove Git usr\bin to avoid link.exe conflicts with MSVC.
set "PATH=%PATH:C:\Program Files\Git\usr\bin;=%"
set "PATH=%PATH:C:\Program Files\Git\usr\bin=%"

echo ==================================================
echo   多 Agent 协同工具 - 启动前检查
echo ==================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-preflight.ps1" -Repair
if errorlevel 1 (
    echo.
    echo ==================================================
    echo   [失败] 启动前检查未通过。
    echo   请按上方日志处理；通常重新运行 环境配置器.bat 即可。
    echo ==================================================
    echo.
    pause
    exit /b 1
)

echo.
echo [启动] 正在运行 npm run tauri:dev ...
echo   首次启动需编译 Rust，可能耗时数分钟，请耐心等待。
echo.

cd /d "%~dp0app"
call npm.cmd run tauri:dev

echo.
if errorlevel 1 (
    echo ==================================================
    echo   [失败] 启动异常退出，错误码 %ERRORLEVEL%，请检查上方日志。
    echo   若为首次运行，请先双击 环境配置器.bat 配置好环境。
    echo ==================================================
) else (
    echo [提示] 应用进程已结束。
)
echo.
pause

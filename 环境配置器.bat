@echo off
setlocal
title 多 Agent 协同工具 - 环境配置器
cd /d "%~dp0"

echo ==================================================
echo   多 Agent 协同工具 · 环境配置器
echo   自动检测并安装 Python / Node / Rust / 构建工具,
echo   创建虚拟环境并安装全部依赖。
echo ==================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-dev-env.ps1"
set EXIT_CODE=%ERRORLEVEL%

echo.
if %EXIT_CODE% neq 0 (
    echo [失败] 环境配置未完成,请检查上方日志。
    echo.
    pause
    exit /b %EXIT_CODE%
)

echo ==================================================
echo   环境配置完成!
echo ==================================================
echo.
choice /c YN /m "是否立即启动应用"
if errorlevel 2 (
    echo 稍后可双击 启动应用.bat 启动应用。
    echo.
    pause
    exit /b 0
)
call "%~dp0启动应用.bat"
exit /b 0

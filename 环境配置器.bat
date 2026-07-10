@echo off
chcp 65001 >nul
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
) else (
    echo ==================================================
    echo   环境配置完成!接下来双击 启动开发环境.bat 即可启动应用。
    echo ==================================================
)
echo.
pause
exit /b %EXIT_CODE%

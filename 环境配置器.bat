@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title 多 Agent 协同工具 - 环境配置器
cd /d "%~dp0"

echo ==================================================
echo   多 Agent 协同工具 · Python 环境配置器
echo ==================================================
echo.

REM 1. 检测 Python 是否安装并在 PATH 中
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 Python。
    echo.
    echo   请先自行安装 Python 3.10 及以上版本,安装时务必勾选
    echo   "Add Python to PATH",然后重新运行本配置器。
    echo   下载地址: https://www.python.org/downloads/
    echo.
    pause
    exit /b 1
)

for /f "delims=" %%v in ('python --version 2^>^&1') do set PYVER=%%v
echo [1/4] 已检测到 !PYVER!
echo.

REM 2. 在项目内创建虚拟环境(随项目迁移,不污染系统)
set VENV_DIR=%~dp0python\venv
if exist "%VENV_DIR%\Scripts\python.exe" (
    echo [2/4] 虚拟环境已存在,跳过创建: %VENV_DIR%
) else (
    echo [2/4] 正在创建虚拟环境: %VENV_DIR%
    python -m venv "%VENV_DIR%"
    if errorlevel 1 (
        echo [错误] 创建虚拟环境失败。
        pause
        exit /b 1
    )
)
echo.

REM 3. 升级 pip
echo [3/4] 升级 pip ...
"%VENV_DIR%\Scripts\python.exe" -m pip install --upgrade pip
echo.

REM 4. 安装依赖
echo [4/4] 安装依赖 (python\requirements.txt) ...
"%VENV_DIR%\Scripts\python.exe" -m pip install -r "%~dp0python\requirements.txt"
if errorlevel 1 (
    echo [警告] 依赖安装过程中出现问题,请检查上方日志。
) else (
    echo.
    echo ==================================================
    echo   环境配置完成!虚拟环境位于:
    echo   %VENV_DIR%
    echo ==================================================
)
echo.
pause

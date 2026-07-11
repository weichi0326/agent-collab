//! Python 子进程生命周期管理。
//! Tauri 启动时拉起 `uvicorn app:app --host 127.0.0.1 --port 18081`，
//! 应用退出时自动终止子进程。
//! 使用 std::process::Command，无需额外 Tauri 插件。

use std::fs::{self, File, OpenOptions};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MAX_RESTARTS: u8 = 3;
const PYTHON_PORT: &str = "18081";
const PYTHON_HOST: &str = "127.0.0.1";

/// 每个 app 会话固定一次的服务鉴权令牌:启动 Python 时经 env 传入,前端每次请求携带,
/// Python 中间件校验(见 app.py)。跨 Python 重启沿用同一 token,故前端可缓存、无需重取。
/// 用 RandomState(OS 熵种子)+时间+进程号混合成 128bit 十六进制,无需引入 rand/uuid 依赖。
static SERVICE_TOKEN: OnceLock<String> = OnceLock::new();

pub fn service_token() -> String {
    SERVICE_TOKEN
        .get_or_init(|| {
            use std::collections::hash_map::RandomState;
            use std::hash::{BuildHasher, Hasher};
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos() as u64)
                .unwrap_or(0);
            let mut token = String::with_capacity(32);
            for _ in 0..2 {
                // 每个 RandomState 独立随机种子(std 用 OS RNG 初始化),两段拼 128bit
                let mut h = RandomState::new().build_hasher();
                h.write_u64(nanos);
                h.write_u32(std::process::id());
                token.push_str(&format!("{:016x}", h.finish()));
            }
            token
        })
        .clone()
}
/// 日志文件超过此大小时，先滚动到 python.log.1 再重新开写，避免无限膨胀。
const PYTHON_LOG_MAX_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Default)]
pub struct PythonState {
    child: Option<Child>,
    restart_attempts: u8,
    user_tools_dir: Option<PathBuf>,
}

/// Tauri managed state：持有 Python 子进程的句柄与重启计数。
pub struct PythonProcess(pub Mutex<PythonState>);

pub fn configure_user_tools_dir(state: &PythonProcess, dir: PathBuf) -> Result<(), String> {
    fs::create_dir_all(&dir).map_err(|e| format!("创建用户工具目录失败: {e}"))?;
    let mut guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
    guard.user_tools_dir = Some(dir);
    Ok(())
}

fn is_forbidden_ipv4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_unspecified()
        || ip.is_multicast()
        || a == 0
        || (a == 100 && (64..=127).contains(&b))
        || (a == 192 && b == 0)
        || (a == 198 && (b == 18 || b == 19))
        || (a == 203 && b == 0 && c == 113)
        || a >= 240
}

fn is_forbidden_ipv6(ip: Ipv6Addr) -> bool {
    let segments = ip.segments();
    ip.is_loopback()
        || ip.is_unspecified()
        || ip.is_multicast()
        || (segments[0] & 0xfe00) == 0xfc00
        || (segments[0] & 0xffc0) == 0xfe80
        || (segments[0] == 0x2001 && segments[1] == 0x0db8)
        || ip.to_ipv4().is_some_and(is_forbidden_ipv4)
}

fn is_forbidden_model_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(value) => is_forbidden_ipv4(value),
        IpAddr::V6(value) => is_forbidden_ipv6(value),
    }
}

fn validate_model_host_inner(hostname: &str, port: u16, allow_local: bool) -> Result<(), String> {
    let hostname = hostname.trim().trim_matches(['[', ']']).to_lowercase();
    let local = matches!(hostname.as_str(), "localhost" | "127.0.0.1");
    if local {
        return if allow_local {
            Ok(())
        } else {
            Err("模型地址不允许访问本机服务".to_string())
        };
    }
    if hostname.is_empty() || port == 0 {
        return Err("模型地址缺少有效主机名或端口".to_string());
    }

    let addresses = (hostname.as_str(), port)
        .to_socket_addrs()
        .map_err(|_| format!("模型地址主机名无法解析: {hostname}"))?
        .collect::<Vec<_>>();
    if addresses.is_empty() {
        return Err(format!("模型地址主机名没有可用 IP: {hostname}"));
    }
    if let Some(address) = addresses
        .iter()
        .find(|address| is_forbidden_model_ip(address.ip()))
    {
        return Err(format!(
            "模型地址解析到私网、回环、链路本地或保留 IP，已拒绝: {}",
            address.ip()
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn validate_model_host(
    hostname: String,
    port: u16,
    allow_local: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_model_host_inner(&hostname, port, allow_local)
    })
    .await
    .map_err(|e| format!("模型地址 DNS 校验任务失败: {e}"))?
}

/// L26 修复：抽取公共项目根目录定位逻辑，消除 find_python_exe/find_app_dir 的重复代码。
/// - dev 模式（debug_assertions）：CARGO_MANIFEST_DIR 上溯两级到项目根
/// - release 模式：可执行文件同级目录
fn find_project_root() -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        manifest.parent()?.parent()?.to_path_buf().into()
    } else {
        std::env::current_exe().ok()?.parent()?.to_path_buf().into()
    }
}

/// 定位 Python 解释器可执行文件。
/// - dev（debug_assertions）：项目内 venv（`python/venv/Scripts/python.exe`）。
/// - release：随安装包分发的可重定位 standalone CPython（`python/runtime/python.exe`），
///   解释器在 runtime 根而非 Scripts 下，与开发 venv 布局不同。
fn find_python_exe() -> Option<PathBuf> {
    let python_root = find_project_root()?.join("python");
    let python = if cfg!(debug_assertions) {
        // dev：venv/Scripts/python.exe（Windows）或 venv/bin/python（其它平台）
        if cfg!(target_os = "windows") {
            python_root.join("venv").join("Scripts").join("python.exe")
        } else {
            python_root.join("venv").join("bin").join("python")
        }
    } else {
        // release：standalone CPython 的 runtime 根
        if cfg!(target_os = "windows") {
            python_root.join("runtime").join("python.exe")
        } else {
            python_root.join("runtime").join("bin").join("python3")
        }
    };
    if python.exists() {
        Some(python)
    } else {
        None
    }
}

/// 拼接 python/app.py 所在目录（FastAPI 的 --app-dir 参数）。
fn find_app_dir() -> Option<PathBuf> {
    Some(find_project_root()?.join("python"))
}

/// 打开 `logs/python.log` 供子进程 stdout/stderr 追加写入。
/// append 模式保留跨重启历史；超过上限先滚动到 python.log.1 单份备份再重开。
/// 定位失败或 IO 出错时返回 None（回退到 Stdio::null，不阻断服务启动）。
fn open_python_log() -> Option<File> {
    let log_dir = find_project_root()?.join("logs");
    if let Err(e) = fs::create_dir_all(&log_dir) {
        log::warn!("[python_manager] 创建 logs/ 目录失败: {e}");
        return None;
    }
    let log_path = log_dir.join("python.log");
    if let Ok(meta) = fs::metadata(&log_path) {
        if meta.len() > PYTHON_LOG_MAX_BYTES {
            let backup = log_dir.join("python.log.1");
            if let Err(e) = fs::rename(&log_path, &backup) {
                log::warn!("[python_manager] 滚动 python.log 失败: {e}");
            }
        }
    }
    match OpenOptions::new().create(true).append(true).open(&log_path) {
        Ok(f) => Some(f),
        Err(e) => {
            log::warn!("[python_manager] 打开 python.log 失败: {e}");
            None
        }
    }
}

fn is_service_port_open() -> bool {
    let addr = format!("{PYTHON_HOST}:{PYTHON_PORT}");
    let Ok(addr) = addr.parse::<SocketAddr>() else {
        return false;
    };
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

#[cfg(target_os = "windows")]
fn listener_pids_on_port(port: &str) -> Vec<u32> {
    let output = Command::new("netstat").args(["-ano", "-p", "tcp"]).output();
    let text = match output {
        Ok(out) => String::from_utf8_lossy(&out.stdout).to_string(),
        Err(e) => {
            log::warn!("[python_manager] netstat 执行失败: {e}");
            return Vec::new();
        }
    };

    let needle1 = format!("127.0.0.1:{port}");
    let needle2 = format!("0.0.0.0:{port}");
    let needle3 = format!("[::1]:{port}");
    let mut pids = Vec::new();
    for line in text.lines() {
        if !line.contains("LISTENING") {
            continue;
        }
        if !(line.contains(&needle1) || line.contains(&needle2) || line.contains(&needle3)) {
            continue;
        }
        if let Some(pid) = line.split_whitespace().last().and_then(|s| s.parse().ok()) {
            pids.push(pid);
        }
    }
    pids.sort_unstable();
    pids.dedup();
    pids
}

#[cfg(target_os = "windows")]
struct ProcessIdentity {
    executable_path: PathBuf,
    command_line: String,
}

#[cfg(target_os = "windows")]
fn process_identity_for_pid(pid: u32) -> Option<ProcessIdentity> {
    let script = format!(
        concat!(
            "$p=Get-CimInstance Win32_Process -Filter \"ProcessId = {pid}\";",
            "if($null -ne $p){{",
            "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;",
            "Write-Output ('EXE='+$p.ExecutablePath);",
            "Write-Output ('CMD='+$p.CommandLine)}}"
        ),
        pid = pid,
    );
    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", &script])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let executable_path = text
        .lines()
        .find_map(|line| line.strip_prefix("EXE="))
        .map(str::trim)
        .filter(|line| !line.is_empty())?;
    let command_line = text
        .lines()
        .find_map(|line| line.strip_prefix("CMD="))
        .map(str::trim)
        .filter(|line| !line.is_empty())?;
    Some(ProcessIdentity {
        executable_path: PathBuf::from(executable_path),
        command_line: command_line.to_string(),
    })
}

#[cfg(target_os = "windows")]
fn path_key(path: &Path) -> String {
    let normalized = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    normalized
        .to_string_lossy()
        .trim_start_matches(r"\\?\")
        .replace('/', "\\")
        .to_lowercase()
}

#[cfg(target_os = "windows")]
fn command_line_tokens(command_line: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    for character in command_line.chars() {
        match character {
            '"' => quoted = !quoted,
            value if value.is_whitespace() && !quoted => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
            }
            value => current.push(value),
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

#[cfg(target_os = "windows")]
fn command_arg_value(tokens: &[String], flag: &str) -> Option<String> {
    tokens
        .windows(2)
        .find(|pair| pair[0].eq_ignore_ascii_case(flag))
        .map(|pair| pair[1].clone())
}

#[cfg(target_os = "windows")]
fn matches_service_identity(
    identity: &ProcessIdentity,
    expected_exe: &Path,
    expected_app_dir: &Path,
) -> bool {
    if path_key(&identity.executable_path) != path_key(expected_exe) {
        return false;
    }
    let tokens = command_line_tokens(&identity.command_line);
    let exact_module = tokens.windows(3).any(|args| {
        args[0] == "-m"
            && args[1].eq_ignore_ascii_case("uvicorn")
            && args[2].eq_ignore_ascii_case("app:app")
    });
    let app_dir = command_arg_value(&tokens, "--app-dir");
    let port = command_arg_value(&tokens, "--port");
    exact_module
        && port.as_deref() == Some(PYTHON_PORT)
        && app_dir
            .as_deref()
            .map(Path::new)
            .map(path_key)
            .is_some_and(|value| value == path_key(expected_app_dir))
}

#[cfg(target_os = "windows")]
fn is_our_python_listener_on_port() -> bool {
    let (Some(expected_exe), Some(expected_app_dir)) = (find_python_exe(), find_app_dir()) else {
        return false;
    };
    listener_pids_on_port(PYTHON_PORT).into_iter().any(|pid| {
        process_identity_for_pid(pid)
            .map(|identity| matches_service_identity(&identity, &expected_exe, &expected_app_dir))
            .unwrap_or(false)
    })
}

#[cfg(not(target_os = "windows"))]
fn is_our_python_listener_on_port() -> bool {
    false
}

#[cfg(target_os = "windows")]
pub fn stop_orphan_python_listeners() {
    let current_pid = std::process::id();
    let (Some(expected_exe), Some(expected_app_dir)) = (find_python_exe(), find_app_dir()) else {
        log::warn!("[python_manager] 无法定位本项目 Python 身份，跳过孤儿进程清理");
        return;
    };
    for pid in listener_pids_on_port(PYTHON_PORT) {
        if pid == current_pid {
            continue;
        }
        let identity = process_identity_for_pid(pid);
        if !identity
            .as_ref()
            .map(|value| matches_service_identity(value, &expected_exe, &expected_app_dir))
            .unwrap_or(false)
        {
            let detail = identity
                .map(|value| value.command_line)
                .unwrap_or_else(|| "<无法读取进程身份>".to_string());
            log::warn!(
                "[python_manager] 端口 {PYTHON_PORT} 被 PID={pid} 占用，但解释器或 app-dir 与本项目不符，跳过。cmd={detail}"
            );
            continue;
        }

        match Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .output()
        {
            Ok(out) if out.status.success() => {
                log::info!("[python_manager] 已清理旧 Python 服务 PID={pid}");
            }
            Ok(out) => {
                log::warn!(
                    "[python_manager] 清理旧 Python 服务 PID={pid} 失败: {}",
                    String::from_utf8_lossy(&out.stderr)
                );
            }
            Err(e) => log::warn!("[python_manager] taskkill 执行失败: {e}"),
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn stop_orphan_python_listeners() {}

/// 启动 Python FastAPI 服务。返回 Ok(true) 表示已成功提交 spawn，
/// 返回 Ok(false) 表示 venv 未找到（未配置 Python 环境），
/// 返回 Err 表示 spawn 失败。
pub fn start(state: &PythonProcess) -> Result<bool, String> {
    {
        let mut guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(child) = guard.child.as_mut() {
            if child.try_wait().map_err(|e| e.to_string())?.is_none() {
                return Ok(true);
            }
            guard.child.take();
        }
    }

    if is_service_port_open() {
        if is_our_python_listener_on_port() {
            log::warn!("[python_manager] 端口 {PYTHON_PORT} 已有本应用 Python 服务，复用当前后台");
            return Ok(true);
        }
        log::error!("[python_manager] 端口 {PYTHON_PORT} 被非本应用进程占用，无法启动 Python 服务");
        return Err(format!(
            "端口 {PYTHON_PORT} 被其他程序占用，无法启动 Python 服务。请关闭占用 127.0.0.1:{PYTHON_PORT} 的程序后重试。"
        ));
    }

    let python_exe = match find_python_exe() {
        Some(p) => p,
        None => {
            log::warn!("[python_manager] 未找到 venv Python，跳过服务启动");
            return Ok(false);
        }
    };

    let app_dir = match find_app_dir() {
        Some(d) => d,
        None => return Err("无法定位 python/ 目录".to_string()),
    };

    let user_tools_dir = {
        let guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
        guard.user_tools_dir.clone()
    };

    // L25 修复：app_dir 含非 UTF-8 字符时明确报错，不再静默回退到 "."（可能导致找错目录）
    let app_dir_str = app_dir
        .to_str()
        .ok_or_else(|| format!("python/ 目录路径含非 UTF-8 字符: {:?}", app_dir))?;

    let mut cmd = Command::new(&python_exe);
    cmd.args([
        "-m",
        "uvicorn",
        "app:app",
        "--host",
        PYTHON_HOST,
        "--port",
        PYTHON_PORT,
        "--app-dir",
        app_dir_str,
        "--log-level",
        "warning",
    ]);

    // 关闭 Python 输出缓冲，否则重定向到文件后是块缓冲，日志要等崩溃/退出才刷出来。
    cmd.env("PYTHONUNBUFFERED", "1");

    // 服务鉴权令牌:传给 Python(app.py 中间件校验),前端经 service_token 命令取同一值。
    // 阻止本机其它程序/恶意网页直接打 localhost:18081 调工具、装工具。
    cmd.env("MULTIAGENT_SERVICE_TOKEN", service_token());
    if let Some(dir) = user_tools_dir {
        fs::create_dir_all(&dir).map_err(|e| format!("创建用户工具目录失败: {e}"))?;
        cmd.env("MULTIAGENT_USER_TOOLS_DIR", dir);
    }

    // 子进程 stdout/stderr 落盘到 logs/python.log（同一文件句柄克隆给两路）。
    // 打不开日志时回退到 Stdio::null，保持原有「丢弃输出」行为，不阻断服务。
    match open_python_log() {
        Some(file) => {
            let err_handle = file.try_clone().ok();
            cmd.stdout(Stdio::from(file));
            match err_handle {
                Some(f) => {
                    cmd.stderr(Stdio::from(f));
                }
                None => {
                    cmd.stderr(Stdio::null());
                }
            }
        }
        None => {
            cmd.stdout(Stdio::null());
            cmd.stderr(Stdio::null());
        }
    }

    // Windows：隐藏控制台窗口，避免弹出黑窗
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Python 服务启动失败: {e}"))?;
    std::thread::sleep(Duration::from_millis(700));
    match child.try_wait() {
        Ok(Some(status)) => {
            log::error!("[python_manager] Python 服务启动后立即退出，状态={status}");
            return Err(format!(
                "Python 服务启动后立即退出，状态={status}。请查看 logs/python.log，或重新运行环境配置器重建 python\\venv。"
            ));
        }
        Ok(None) => {}
        Err(e) => {
            log::error!("[python_manager] 检查 Python 服务启动状态失败: {e}");
            return Err(format!("检查 Python 服务启动状态失败: {e}"));
        }
    }
    log::info!("[python_manager] Python 服务已启动，PID={}", child.id());

    // M5 修复：unwrap_or_else 处理 Mutex 中毒，即使中毒也能继续写入
    let mut guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
    guard.child = Some(child);
    Ok(true)
}

/// 停止 Python 子进程（应用退出时调用）。
pub fn stop(state: &PythonProcess) {
    // M5 修复：Mutex 中毒容错
    let mut guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(mut child) = guard.child.take() {
        let pid = child.id();
        if let Err(e) = child.kill() {
            log::warn!("[python_manager] 终止 Python 进程 {pid} 失败: {e}");
        } else {
            log::info!("[python_manager] Python 进程 {pid} 已终止");
        }
    }
}

pub fn restart(state: &PythonProcess) -> Result<bool, String> {
    stop(state);
    stop_orphan_python_listeners();
    {
        let mut guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
        guard.restart_attempts = 0;
    }
    start(state)
}

/// Tauri 命令：查询 Python 服务进程状态。
/// 返回 "running"（句柄存在且进程未退出）或 "stopped"。
/// 前端取当前会话服务令牌,注入到每个 Python 请求的 X-Service-Token 头。
#[tauri::command]
pub fn service_token_cmd() -> String {
    service_token()
}

#[tauri::command]
pub fn python_status(state: tauri::State<'_, PythonProcess>) -> String {
    // M5 修复：Mutex 中毒容错
    let mut guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(child) = guard.child.as_mut() {
        match child.try_wait() {
            Ok(None) => return "running".to_string(), // 进程仍在运行
            Ok(Some(status)) => {
                log::warn!("[python_manager] Python 进程已退出，状态={status}");
                guard.child.take(); // 清除句柄
            }
            Err(e) => {
                log::error!("[python_manager] try_wait 失败: {e}");
                guard.child.take();
            }
        }
    }

    if guard.restart_attempts >= MAX_RESTARTS {
        return "stopped".to_string();
    }
    guard.restart_attempts += 1;
    drop(guard);

    match start(&state) {
        Ok(true) => "running".to_string(),
        Ok(false) => "stopped".to_string(),
        Err(e) => {
            log::error!("[python_manager] Python 服务自动重启失败: {e}");
            "stopped".to_string()
        }
    }
}

#[tauri::command]
pub fn python_restart(state: tauri::State<'_, PythonProcess>) -> Result<String, String> {
    match restart(&state) {
        Ok(true) => Ok("running".to_string()),
        Ok(false) => Ok("stopped".to_string()),
        Err(e) => Err(e),
    }
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    fn identity(executable: &str, app_dir: &str) -> ProcessIdentity {
        ProcessIdentity {
            executable_path: PathBuf::from(executable),
            command_line: format!(
                r#""{executable}" -m uvicorn app:app --host 127.0.0.1 --port 18081 --app-dir "{app_dir}" --log-level warning"#
            ),
        }
    }

    #[test]
    fn service_identity_requires_exact_interpreter_and_project_app_dir() {
        let executable = r"C:\project\python\venv\Scripts\python.exe";
        let app_dir = r"C:\project\python";
        assert!(matches_service_identity(
            &identity(executable, app_dir),
            Path::new(executable),
            Path::new(app_dir),
        ));

        assert!(!matches_service_identity(
            &identity(r"C:\other\python.exe", app_dir),
            Path::new(executable),
            Path::new(app_dir),
        ));
        assert!(!matches_service_identity(
            &identity(executable, r"C:\other\python"),
            Path::new(executable),
            Path::new(app_dir),
        ));
    }

    #[test]
    fn generic_uvicorn_on_same_port_is_not_our_service() {
        let executable = r"C:\project\python\venv\Scripts\python.exe";
        let identity = ProcessIdentity {
            executable_path: PathBuf::from(executable),
            command_line: format!(
                r#""{executable}" -m uvicorn app:app --port 18081 --app-dir "C:\unrelated""#
            ),
        };
        assert!(!matches_service_identity(
            &identity,
            Path::new(executable),
            Path::new(r"C:\project\python"),
        ));
    }

    #[test]
    fn service_identity_rejects_similar_or_disguised_module_commands() {
        let executable = r"C:\project\python\venv\Scripts\python.exe";
        let app_dir = r"C:\project\python";
        for command_line in [
            format!(r#""{executable}" -m uvicornx app:app --port 18081 --app-dir "{app_dir}""#),
            format!(
                r#""{executable}" -m uvicorn other:app --note app:app --port 18081 --app-dir "{app_dir}""#
            ),
        ] {
            assert!(!matches_service_identity(
                &ProcessIdentity {
                    executable_path: PathBuf::from(executable),
                    command_line,
                },
                Path::new(executable),
                Path::new(app_dir),
            ));
        }
    }

    #[test]
    fn model_host_validation_allows_explicit_local_and_rejects_private_ip() {
        assert!(validate_model_host_inner("localhost", 11434, true).is_ok());
        assert!(validate_model_host_inner("127.0.0.1", 8000, false).is_err());
        assert!(validate_model_host_inner("192.168.1.10", 443, false).is_err());
        assert!(validate_model_host_inner("8.8.8.8", 443, false).is_ok());
    }
}

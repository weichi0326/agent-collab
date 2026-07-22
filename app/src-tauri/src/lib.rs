mod python_manager;
mod storage;

use python_manager::{PythonProcess, PythonState};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager, RunEvent};

const TASK_RUNNING_LEASE: Duration = Duration::from_secs(120);

#[derive(Default)]
struct RuntimeState {
    task_running_until: Option<Instant>,
}

struct AppRuntime(Mutex<RuntimeState>);

fn app_base_dir() -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        manifest.parent()?.parent()?.to_path_buf().into()
    } else {
        std::env::current_exe().ok()?.parent()?.to_path_buf().into()
    }
}

fn append_crash_log(text: &str) {
    let Some(base) = app_base_dir() else {
        return;
    };
    let dir = base.join("data");
    let _ = fs::create_dir_all(&dir);
    let path = dir.join("crash.log");
    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) else {
        return;
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default();
    let _ = writeln!(file, "[{now}] {text}");
}

fn install_panic_log() {
    std::panic::set_hook(Box::new(|info| {
        append_crash_log(&format!("Tauri 主进程异常退出: {info}"));
    }));
}

#[tauri::command]
fn set_task_running(state: tauri::State<'_, AppRuntime>, running: bool) {
    let mut guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
    update_task_lease(&mut guard, running, Instant::now());
}

fn is_task_running(state: &AppRuntime) -> bool {
    let guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
    task_running_at(&guard, Instant::now())
}

fn update_task_lease(state: &mut RuntimeState, running: bool, now: Instant) {
    state.task_running_until = running.then_some(now + TASK_RUNNING_LEASE);
}

fn task_running_at(state: &RuntimeState, now: Instant) -> bool {
    state
        .task_running_until
        .is_some_and(|expires_at| expires_at > now)
}

/// 构建 Rust 侧日志插件：落盘到项目 `logs/tauri.log`（与 v2.88 的 python.log 同目录），
/// 保留 Stdout 便于开发；单文件超 5MB 滚动保留一份备份。定位不到 logs/ 时只留 Stdout。
fn build_log_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    use tauri_plugin_log::{RotationStrategy, Target, TargetKind};
    let mut builder = tauri_plugin_log::Builder::new()
        .level(log::LevelFilter::Info)
        .max_file_size(5 * 1024 * 1024)
        .rotation_strategy(RotationStrategy::KeepOne)
        .target(Target::new(TargetKind::Stdout));
    if let Some(dir) = app_base_dir().map(|b| b.join("logs")) {
        let _ = fs::create_dir_all(&dir);
        builder = builder.target(Target::new(TargetKind::Folder {
            path: dir,
            file_name: Some("tauri".into()),
        }));
    }
    builder.build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_running_lease_expires_without_refresh() {
        let started_at = Instant::now();
        let mut state = RuntimeState::default();
        update_task_lease(&mut state, true, started_at);

        assert!(task_running_at(
            &state,
            started_at + TASK_RUNNING_LEASE - Duration::from_secs(1)
        ));
        assert!(!task_running_at(&state, started_at + TASK_RUNNING_LEASE));
    }

    #[test]
    fn task_running_lease_refresh_and_release_are_explicit() {
        let started_at = Instant::now();
        let mut state = RuntimeState::default();
        update_task_lease(&mut state, true, started_at);
        update_task_lease(&mut state, true, started_at + Duration::from_secs(60));

        assert!(task_running_at(
            &state,
            started_at + TASK_RUNNING_LEASE + Duration::from_secs(30)
        ));

        update_task_lease(&mut state, false, started_at + Duration::from_secs(90));
        assert!(!task_running_at(
            &state,
            started_at + Duration::from_secs(90)
        ));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_log();

    let mut builder = tauri::Builder::default();

    // 单实例锁必须最先注册：防双开，第二个进程只聚焦已有窗口后退出，
    // 不会重复进入 setup 拉起第二个 Python，避免两个进程抢写同一份项目 JSON。
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }));
    }

    builder
        .plugin(build_log_plugin())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .manage(PythonProcess(Mutex::new(PythonState::default())))
        .manage(AppRuntime(Mutex::new(RuntimeState::default())))
        .setup(|app| {
            let state = app.state::<PythonProcess>();
            match app.path().app_local_data_dir() {
                Ok(dir) => {
                    if let Err(e) = storage::configure_user_skills_dir(dir.clone()) {
                        log::error!("[setup] 用户 Skill 目录配置失败: {e}");
                    }
                    let tools_dir = dir.join("python-tools");
                    if let Err(e) = python_manager::configure_user_tools_dir(&state, tools_dir) {
                        log::error!("[setup] 用户工具目录配置失败: {e}");
                    }
                }
                Err(e) => log::error!("[setup] 无法定位本地应用数据目录: {e}"),
            }
            // 冷启动先清理上次残留的旧版本 Python 监听（仅杀 cmdline 匹配本服务的进程），
            // 保证复用/新起的后台是当前版本，消除「复用旧代码」隐患。
            python_manager::stop_orphan_python_listeners();
            // 启动 Python 服务（venv 不存在时跳过，不阻塞应用启动）
            match python_manager::start(&state) {
                Ok(true) => log::info!("[setup] Python 服务已请求启动"),
                Ok(false) => log::warn!("[setup] 未找到 Python venv，服务未启动"),
                Err(e) => log::error!("[setup] Python 服务启动失败: {e}"),
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    let runtime = window.app_handle().state::<AppRuntime>();
                    if is_task_running(&runtime) {
                        api.prevent_close();
                        let _ = window.emit(
                            "app-close-blocked",
                            "任务运行中，请先中止任务或等待运行完成。",
                        );
                    }
                }
                tauri::WindowEvent::Destroyed => {
                    // 窗口销毁时停止 Python 子进程
                    let state = window.app_handle().state::<PythonProcess>();
                    python_manager::stop(&state);
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            set_task_running,
            storage::storage_get,
            storage::storage_set,
            storage::storage_remove,
            storage::output_dir,
            storage::open_output_dir,
            storage::system_snapshot,
            storage::open_system_directory,
            storage::scan_cleanable_app_data,
            storage::clear_selected_app_data,
            storage::path_exists,
            storage::open_path,
            storage::list_output_reports,
            storage::delete_output_report,
            storage::list_jizi_skill_files,
            storage::save_jizi_skill_file,
            storage::overwrite_jizi_skill_file,
            storage::write_jizi_skill_files,
            storage::delete_jizi_skill_file,
            storage::read_text_file,
            python_manager::python_status,
            python_manager::python_restart,
            python_manager::validate_model_host,
            python_manager::service_token_cmd
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // 退出兜底：正常/异常退出路径都杀掉 Python 子进程，防止孤儿占用 18081。
            if let RunEvent::ExitRequested { .. } = event {
                let state = app_handle.state::<PythonProcess>();
                python_manager::stop(&state);
            }
        });
}

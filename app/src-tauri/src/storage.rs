use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;
use tauri_plugin_fs::FsExt;

// M12 修复：value 大小上限（10 MB），防止单次写盘超大 JSON 导致磁盘耗尽
const MAX_VALUE_SIZE: usize = 10 * 1024 * 1024; // 10 MB

// M12 修复：key 长度上限，防止超过 Windows MAX_PATH (260)
// L24: storage key 无长度限制，极长 key 会超出 OS 路径限制
const MAX_KEY_LEN: usize = 100;

const OUTPUT_REPORT_LIMIT: usize = 80;
const OUTPUT_REPORT_SCAN_TARGET: usize = 200;
const OUTPUT_REPORT_MAX_DIRS: usize = 5000;
const DIRECTORY_SCAN_MAX_ENTRIES: usize = 20_000;
const DIRECTORY_SCAN_MAX_DEPTH: usize = 64;
const DIRECTORY_USAGE_DETAIL_LIMIT: usize = 8;
const DIRECTORY_WRITE_PROBE_NAME: &str = ".system-write-probe.tmp";
static DIRECTORY_WRITE_PROBE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Serialize)]
pub struct OutputReport {
    id: String,
    canvas_name: String,
    node_id: String,
    node_label: String,
    output_format: String,
    run_at: String,
    summary: String,
    folder_path: String,
    artifact_name: String,
    artifact_path: String,
    data_path: String,
}

#[derive(Serialize)]
pub struct JiziSkillFile {
    id: String,
    path: String,
    content: String,
}

#[derive(Serialize)]
pub struct SystemCheck {
    id: String,
    label: String,
    ok: bool,
    detail: String,
    repair: String,
}

#[derive(Serialize)]
pub struct DirectoryUsage {
    bytes: u64,
    complete: bool,
    detail: String,
}

#[derive(Serialize)]
pub struct SystemSnapshot {
    app_version: String,
    backend_version: String,
    os: String,
    arch: String,
    data_dir: String,
    app_data_dir: String,
    output_dir: String,
    log_dir: String,
    data_usage: DirectoryUsage,
    app_data_usage: DirectoryUsage,
    output_usage: DirectoryUsage,
    log_usage: DirectoryUsage,
    checks: Vec<SystemCheck>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanableItem {
    id: String,
    label: String,
    description: String,
    impact: String,
    path: String,
    usage: DirectoryUsage,
    important: bool,
    default_selected: bool,
    exists: bool,
}

#[derive(Serialize)]
pub struct CleanableScan {
    items: Vec<CleanableItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearSelectedAppDataInput {
    item_ids: Vec<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct ClearSelectedAppDataResult {
    cleared: Vec<String>,
}

// 数据根目录:所有 store 的 JSON 都存在这里,随项目文件夹迁移。
// 开发期 = 项目顶层 <项目根>/data(CARGO_MANIFEST_DIR 指向 app/src-tauri,上溯两级到项目根)。
// 打包后 = 可执行文件同级 data(便携版:exe 与 data 一起压缩带走)。
// M12 修复：data_dir() 只在第一次被调用时创建目录（通过 OnceLock 缓存路径），
// 避免每次 storage_get/set/remove 都触发 create_dir_all syscall。
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

static DATA_DIR_CACHE: OnceLock<Result<PathBuf, String>> = OnceLock::new();
static USER_SKILLS_DIR: OnceLock<PathBuf> = OnceLock::new();

fn data_dir() -> Result<&'static PathBuf, String> {
    DATA_DIR_CACHE
        .get_or_init(|| {
            let base = if cfg!(debug_assertions) {
                let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
                manifest
                    .parent() // app/
                    .and_then(|p| p.parent()) // 项目根
                    .map(|p| p.to_path_buf())
                    .ok_or_else(|| "无法定位项目根目录".to_string())?
            } else {
                std::env::current_exe()
                    .map_err(|e| e.to_string())?
                    .parent()
                    .map(|p| p.to_path_buf())
                    .ok_or_else(|| "无法定位可执行文件目录".to_string())?
            };
            let dir = base.join("data");
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            Ok(dir)
        })
        .as_ref()
        .map_err(|e| e.clone())
}

fn app_base_dir() -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        manifest
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.to_path_buf())
            .ok_or_else(|| "无法定位项目根目录".to_string())
    } else {
        std::env::current_exe()
            .map_err(|e| e.to_string())?
            .parent()
            .map(|p| p.to_path_buf())
            .ok_or_else(|| "无法定位可执行文件目录".to_string())
    }
}

pub fn configure_user_skills_dir(user_data_dir: PathBuf) -> Result<(), String> {
    let target = user_data_dir.join("skills");
    fs::create_dir_all(&target).map_err(|e| e.to_string())?;

    let legacy = app_base_dir()?
        .join("jizi-agent-architecture")
        .join("skills");
    let migration_error = migrate_legacy_skills(&legacy, &target).err();
    USER_SKILLS_DIR
        .set(target)
        .map_err(|_| "用户 Skill 目录已配置".to_string())?;
    if let Some(error) = migration_error {
        log::warn!("[skills] 旧 Skill 迁移未完全成功，已继续使用新目录: {error}");
    }
    Ok(())
}

fn migrate_legacy_skills(legacy: &Path, target: &Path) -> Result<(), String> {
    if !legacy.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(legacy).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let source_dir = entry.path();
        if !source_dir.is_dir() {
            continue;
        }
        let Some(id) = source_dir.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !valid_skill_id(id) {
            continue;
        }
        let source = source_dir.join("SKILL.md");
        let destination_dir = target.join(id);
        let destination = destination_dir.join("SKILL.md");
        if source.is_file() && !destination.exists() {
            fs::create_dir_all(&destination_dir).map_err(|e| e.to_string())?;
            fs::copy(&source, &destination).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn user_skills_dir() -> Result<&'static PathBuf, String> {
    USER_SKILLS_DIR
        .get()
        .ok_or_else(|| "用户 Skill 目录尚未配置".to_string())
}

fn valid_skill_id(id: &str) -> bool {
    id.len() >= 2
        && id.len() <= 48
        && !id.starts_with('-')
        && !id.ends_with('-')
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

#[tauri::command]
pub fn output_dir() -> Result<String, String> {
    let dir = output_dir_path()?;
    dir.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| format!("输出目录路径包含非 UTF-8 字符: {:?}", dir))
}

fn output_dir_path() -> Result<PathBuf, String> {
    let dir = app_base_dir()?.join("outputs");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn mark_directory_usage_incomplete(complete: &mut bool, details: &mut Vec<String>, detail: String) {
    *complete = false;
    if details.len() < DIRECTORY_USAGE_DETAIL_LIMIT {
        details.push(detail);
    }
}

fn add_directory_usage_bytes(
    bytes: &mut u64,
    additional_bytes: u64,
    complete: &mut bool,
    details: &mut Vec<String>,
) {
    match bytes.checked_add(additional_bytes) {
        Some(total) => *bytes = total,
        None => {
            *bytes = u64::MAX;
            mark_directory_usage_incomplete(
                complete,
                details,
                "目录累计大小超过可表示的大小上限".to_string(),
            );
        }
    }
}

fn directory_usage(path: &Path) -> DirectoryUsage {
    directory_usage_with_limits(path, DIRECTORY_SCAN_MAX_ENTRIES, DIRECTORY_SCAN_MAX_DEPTH)
}

fn directory_usage_with_limits(
    path: &Path,
    max_entries: usize,
    max_depth: usize,
) -> DirectoryUsage {
    let mut bytes = 0_u64;
    let mut complete = true;
    let mut details = Vec::new();
    let mut pending = vec![(path.to_path_buf(), 0_usize)];
    let mut scanned_entries = 0_usize;
    let mut entry_budget_exhausted = false;

    while let Some((current, depth)) = pending.pop() {
        let metadata = match fs::symlink_metadata(&current) {
            Ok(metadata) => metadata,
            Err(error) => {
                mark_directory_usage_incomplete(
                    &mut complete,
                    &mut details,
                    format!("无法读取 {}：{error}", current.display()),
                );
                continue;
            }
        };

        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_file() {
            add_directory_usage_bytes(&mut bytes, metadata.len(), &mut complete, &mut details);
            continue;
        }
        if !metadata.is_dir() {
            continue;
        }

        if entry_budget_exhausted {
            continue;
        }

        if depth >= max_depth {
            match fs::read_dir(&current) {
                Ok(mut entries) => {
                    if entries.next().is_some() {
                        mark_directory_usage_incomplete(
                            &mut complete,
                            &mut details,
                            format!("目录达到深度上限 {max_depth}：{}", current.display()),
                        );
                    }
                }
                Err(error) => mark_directory_usage_incomplete(
                    &mut complete,
                    &mut details,
                    format!("无法读取目录 {}：{error}", current.display()),
                ),
            }
            continue;
        }

        let entries = match fs::read_dir(&current) {
            Ok(entries) => entries,
            Err(error) => {
                mark_directory_usage_incomplete(
                    &mut complete,
                    &mut details,
                    format!("无法读取目录 {}：{error}", current.display()),
                );
                continue;
            }
        };

        for entry in entries {
            if scanned_entries >= max_entries {
                mark_directory_usage_incomplete(
                    &mut complete,
                    &mut details,
                    format!("目录扫描达到条目上限 {max_entries}：{}", current.display()),
                );
                entry_budget_exhausted = true;
                break;
            }
            scanned_entries += 1;
            match entry {
                Ok(entry) => pending.push((entry.path(), depth + 1)),
                Err(error) => mark_directory_usage_incomplete(
                    &mut complete,
                    &mut details,
                    format!("读取目录项失败 {}：{error}", current.display()),
                ),
            }
        }
    }

    DirectoryUsage {
        bytes,
        complete,
        detail: if complete {
            "统计完整".to_string()
        } else {
            details.join("；")
        },
    }
}

fn path_check(id: &str, label: &str, path: &Path, repair: &str) -> SystemCheck {
    let ok = path.is_file();
    let display = path.to_string_lossy();
    SystemCheck {
        id: id.to_string(),
        label: label.to_string(),
        ok,
        detail: if ok {
            display.into_owned()
        } else {
            format!("未找到：{display}")
        },
        repair: repair.to_string(),
    }
}

fn probe_directory_writable(path: &Path) -> Result<(), String> {
    probe_directory_writable_with_remover(path, &|probe| fs::remove_file(probe))
}

fn probe_directory_writable_with_remover<F>(path: &Path, remove_file: &F) -> Result<(), String>
where
    F: Fn(&Path) -> std::io::Result<()>,
{
    let _guard = DIRECTORY_WRITE_PROBE_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    fs::create_dir_all(path).map_err(|error| error.to_string())?;
    let probe = path.join(DIRECTORY_WRITE_PROBE_NAME);
    match fs::symlink_metadata(&probe) {
        Ok(_) => remove_file(&probe).map_err(|error| format!("清理旧写入探针失败：{error}"))?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("检查旧写入探针失败：{error}")),
    }

    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
        .map_err(|error| error.to_string())?;
    let write_error = file.write_all(b"system-directory-write-probe").err();
    drop(file);
    let cleanup_error = remove_file(&probe).err();

    match (write_error, cleanup_error) {
        (None, None) => Ok(()),
        (Some(write_error), None) => Err(write_error.to_string()),
        (None, Some(cleanup_error)) => Err(format!("删除写入探针失败：{cleanup_error}")),
        (Some(write_error), Some(cleanup_error)) => Err(format!(
            "写入探针失败：{write_error}；删除写入探针失败：{cleanup_error}"
        )),
    }
}

fn directory_check(id: &str, label: &str, path: &Path) -> SystemCheck {
    let probe_result = probe_directory_writable(path);
    let ok = probe_result.is_ok();
    let display = path.to_string_lossy();
    SystemCheck {
        id: id.to_string(),
        label: label.to_string(),
        ok,
        detail: match probe_result {
            Ok(()) => display.into_owned(),
            Err(error) => format!("目录不可写：{display}（{error}）"),
        },
        repair: "检查应用目录权限；仍不可用时重新运行环境配置器或重新安装应用。".to_string(),
    }
}

fn python_interpreter_path(base: &Path) -> PathBuf {
    let python_root = base.join("python");
    if cfg!(debug_assertions) {
        if cfg!(target_os = "windows") {
            python_root.join("venv").join("Scripts").join("python.exe")
        } else {
            python_root.join("venv").join("bin").join("python")
        }
    } else if cfg!(target_os = "windows") {
        python_root.join("runtime").join("python.exe")
    } else {
        python_root.join("runtime").join("bin").join("python3")
    }
}

fn build_system_checks(
    base: &Path,
    data_dir: &Path,
    app_data_dir: &Path,
    output_dir: &Path,
    log_dir: &Path,
    include_development_checks: bool,
) -> Vec<SystemCheck> {
    let python_interpreter = python_interpreter_path(base);
    let python_app = base.join("python").join("app.py");

    let mut checks = vec![
        path_check(
            "python-interpreter",
            "Python 解释器",
            &python_interpreter,
            "运行环境配置器重新创建 Python 环境；安装版请重新安装应用。",
        ),
        path_check(
            "python-app",
            "Python 服务入口",
            &python_app,
            "确认 python/app.py 未被移动或删除；缺失时重新获取完整应用文件。",
        ),
        directory_check("data-directory", "本地数据目录", data_dir),
        directory_check("app-data-directory", "应用数据目录", app_data_dir),
        directory_check("output-directory", "输出目录", output_dir),
        directory_check("log-directory", "日志目录", log_dir),
    ];

    if include_development_checks {
        checks.push(path_check(
            "environment-configurator",
            "环境配置器",
            &base.join("环境配置器.bat"),
            "在完整项目目录中运行“环境配置器.bat”；安装版环境由安装程序维护。",
        ));
        checks.push(path_check(
            "launch-preflight",
            "启动预检脚本",
            &base.join("start-preflight.ps1"),
            "使用完整项目目录中的“启动应用.bat”，或重新获取 start-preflight.ps1。",
        ));
    }

    checks
}

fn build_system_snapshot(base: PathBuf, app_data_dir: PathBuf) -> Result<SystemSnapshot, String> {
    let data_dir = base.join("data");
    let output_dir = base.join("outputs");
    let log_dir = base.join("logs");
    let checks = build_system_checks(
        &base,
        &data_dir,
        &app_data_dir,
        &output_dir,
        &log_dir,
        cfg!(debug_assertions),
    );
    let data_usage = directory_usage(&data_dir);
    let app_data_usage = directory_usage(&app_data_dir);
    let output_usage = directory_usage(&output_dir);
    let log_usage = directory_usage(&log_dir);

    Ok(SystemSnapshot {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        backend_version: env!("CARGO_PKG_VERSION").to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        data_dir: path_to_string(&data_dir)?,
        app_data_dir: path_to_string(&app_data_dir)?,
        output_dir: path_to_string(&output_dir)?,
        log_dir: path_to_string(&log_dir)?,
        data_usage,
        app_data_usage,
        output_usage,
        log_usage,
        checks,
    })
}

#[tauri::command]
pub async fn system_snapshot(app: tauri::AppHandle) -> Result<SystemSnapshot, String> {
    let base = app_base_dir()?;
    let app_data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?;

    tauri::async_runtime::spawn_blocking(move || build_system_snapshot(base, app_data_dir))
        .await
        .map_err(|error| format!("系统快照任务失败：{error}"))?
}

fn clear_directory_contents(path: &Path) -> Result<(), String> {
    if !path.exists() {
        fs::create_dir_all(path).map_err(|error| error.to_string())?;
        return Ok(());
    }
    for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let target = entry.path();
        if target.is_dir() {
            fs::remove_dir_all(&target).map_err(|error| error.to_string())?;
        } else {
            fs::remove_file(&target).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn remove_file_if_exists(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn remove_named_data_files(data_dir: &Path, names: &[&str]) -> Result<(), String> {
    for name in names {
        remove_file_if_exists(&data_dir.join(name))?;
        remove_file_if_exists(&data_dir.join(name).with_extension("bak"))?;
    }
    Ok(())
}

fn is_fictionist_data_file_name(name: &str) -> bool {
    name.starts_with("multi-agent-fictionist-")
        && [".json", ".bak", ".tmp"]
            .iter()
            .any(|suffix| name.ends_with(suffix))
}

fn fictionist_data_files(data_dir: &Path) -> Result<Vec<PathBuf>, String> {
    if !data_dir.exists() {
        return Ok(Vec::new());
    }
    let mut paths = Vec::new();
    for entry in fs::read_dir(data_dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_file()
        {
            continue;
        }
        let name = entry.file_name();
        if name.to_str().is_some_and(is_fictionist_data_file_name) {
            paths.push(entry.path());
        }
    }
    paths.sort();
    Ok(paths)
}

fn fictionist_cleanable_paths(data_dir: &Path) -> Result<Vec<PathBuf>, String> {
    let paths = fictionist_data_files(data_dir)?;
    if paths.is_empty() {
        Ok(vec![data_dir.join("multi-agent-fictionist-*.json")])
    } else {
        Ok(paths)
    }
}

fn remove_fictionist_data_files(data_dir: &Path) -> Result<(), String> {
    for path in fictionist_data_files(data_dir)? {
        remove_file_if_exists(&path)?;
    }
    Ok(())
}

fn combined_usage(paths: &[PathBuf]) -> DirectoryUsage {
    let mut bytes = 0_u64;
    let mut complete = true;
    let mut details = Vec::new();
    for path in paths {
        if !path.exists() {
            continue;
        }
        let usage = directory_usage(path);
        add_directory_usage_bytes(&mut bytes, usage.bytes, &mut complete, &mut details);
        if !usage.complete {
            mark_directory_usage_incomplete(&mut complete, &mut details, usage.detail);
        }
    }
    DirectoryUsage {
        bytes,
        complete,
        detail: if complete {
            "统计完整".to_string()
        } else {
            details.join("；")
        },
    }
}

fn has_existing_path(paths: &[PathBuf]) -> bool {
    paths.iter().any(|path| path.exists())
}

fn cleanable_item(
    id: &str,
    label: &str,
    description: &str,
    impact: &str,
    paths: Vec<PathBuf>,
    important: bool,
    default_selected: bool,
) -> Result<CleanableItem, String> {
    Ok(CleanableItem {
        id: id.to_string(),
        label: label.to_string(),
        description: description.to_string(),
        impact: impact.to_string(),
        path: paths
            .iter()
            .map(|path| path_to_string(path))
            .collect::<Result<Vec<_>, _>>()?
            .join("；"),
        usage: combined_usage(&paths),
        important,
        default_selected,
        exists: has_existing_path(&paths),
    })
}

fn build_cleanable_scan(base: &Path, app_data_dir: &Path) -> Result<CleanableScan, String> {
    let data_dir = base.join("data");
    let output_dir = base.join("outputs");
    let log_dir = base.join("logs");
    let fictionist_paths = fictionist_cleanable_paths(&data_dir)?;
    Ok(CleanableScan {
        items: vec![
            cleanable_item(
                "outputs",
                "任务产物",
                "清理任务生成的报告、正文产物和附件文件。",
                "已生成的报告、正文和附件将无法继续查看。",
                vec![output_dir],
                false,
                true,
            )?,
            cleanable_item(
                "logs",
                "运行日志",
                "清理应用运行日志和崩溃日志。",
                "历史运行和崩溃排查记录将被删除。",
                vec![log_dir, data_dir.join("crash.log")],
                false,
                true,
            )?,
            cleanable_item(
                "runtime",
                "运行历史与统计",
                "清理 token 统计和运行临时状态。",
                "历史 token 统计和运行状态记录将被删除。",
                vec![data_dir.join("multi-agent-token-stats.json")],
                false,
                true,
            )?,
            cleanable_item(
                "ui",
                "UI 与引导状态",
                "清理面板状态、引导状态和非关键界面偏好。",
                "面板布局、引导进度和非关键界面偏好将恢复默认。",
                vec![
                    data_dir.join("multi-agent-ui.json"),
                    data_dir.join("multi-agent-onboarding.json"),
                ],
                false,
                true,
            )?,
            cleanable_item(
                "canvas_agents",
                "画布与 Agent 节点",
                "清理画布、Agent 节点库和对应备份。",
                "现有画布和自定义 Agent 节点将被删除，无法继续原有工作流。",
                vec![
                    data_dir.join("multi-agent-canvas.json"),
                    data_dir.join("multi-agent-canvas.bak"),
                    data_dir.join("multi-agent-agents.json"),
                    data_dir.join("multi-agent-agents.bak"),
                ],
                true,
                false,
            )?,
            cleanable_item(
                "fictionist",
                "小说家作品",
                "清理小说作品索引、章节正文、当前选择及其备份和临时文件。",
                "本地小说作品、章节和正文将被删除，无法继续原有写作。",
                fictionist_paths,
                true,
                false,
            )?,
            cleanable_item(
                "jizi",
                "姬子数据",
                "清理姬子会话、编排状态和 Skill 清单。",
                "姬子会话、编排状态和 Skill 启用清单将被删除。",
                vec![
                    data_dir.join("multi-agent-master.json"),
                    data_dir.join("multi-agent-master.bak"),
                    data_dir.join("multi-agent-orchestrator.json"),
                    data_dir.join("multi-agent-orchestrator.bak"),
                    data_dir.join("multi-agent-jizi-skills.json"),
                    data_dir.join("multi-agent-jizi-skills.bak"),
                ],
                true,
                false,
            )?,
            cleanable_item(
                "tools_app_data",
                "自定义工具",
                "清理自定义工具配置、已安装或生成的工具及其依赖。",
                "已安装或生成的自定义工具及其依赖将不可用；内置工具不受影响。",
                vec![
                    data_dir.join("multi-agent-tools.json"),
                    data_dir.join("multi-agent-tools.bak"),
                    app_data_dir.join("python-tools"),
                ],
                true,
                false,
            )?,
            cleanable_item(
                "user_skills",
                "用户 Skill",
                "清理用户创建、导入和覆盖的 Skill 文件。",
                "用户创建、导入和覆盖的 Skill 将被删除；内置 Skill 会恢复默认内容。",
                vec![app_data_dir.join("skills")],
                true,
                false,
            )?,
            cleanable_item(
                "model_search",
                "模型与搜索配置",
                "清理模型 API、搜索 API、Key 和连接配置。",
                "模型与搜索服务将无法调用，直到重新配置连接和 Key。",
                vec![
                    data_dir.join("multi-agent-models.json"),
                    data_dir.join("multi-agent-models.bak"),
                    data_dir.join("multi-agent-search.json"),
                    data_dir.join("multi-agent-search.bak"),
                ],
                true,
                false,
            )?,
        ],
    })
}

fn clear_selected_app_data_impl(
    base: &Path,
    app_data_dir: &Path,
    item_ids: &[&str],
) -> Result<ClearSelectedAppDataResult, String> {
    let data_dir = base.join("data");
    let mut cleared = Vec::new();
    for item_id in item_ids {
        match *item_id {
            "outputs" => clear_directory_contents(&base.join("outputs"))?,
            "logs" => {
                clear_directory_contents(&base.join("logs"))?;
                remove_file_if_exists(&data_dir.join("crash.log"))?;
            }
            "runtime" => remove_named_data_files(&data_dir, &["multi-agent-token-stats.json"])?,
            "ui" => remove_named_data_files(
                &data_dir,
                &["multi-agent-ui.json", "multi-agent-onboarding.json"],
            )?,
            "canvas_agents" => remove_named_data_files(
                &data_dir,
                &["multi-agent-canvas.json", "multi-agent-agents.json"],
            )?,
            "fictionist" => remove_fictionist_data_files(&data_dir)?,
            "jizi" => remove_named_data_files(
                &data_dir,
                &[
                    "multi-agent-master.json",
                    "multi-agent-orchestrator.json",
                    "multi-agent-jizi-skills.json",
                ],
            )?,
            "tools_app_data" => {
                remove_named_data_files(&data_dir, &["multi-agent-tools.json"])?;
                clear_directory_contents(&app_data_dir.join("python-tools"))?;
            }
            "user_skills" => clear_directory_contents(&app_data_dir.join("skills"))?,
            "model_search" => remove_named_data_files(
                &data_dir,
                &["multi-agent-models.json", "multi-agent-search.json"],
            )?,
            unknown => return Err(format!("未知清理分类：{unknown}")),
        }
        cleared.push((*item_id).to_string());
    }
    Ok(ClearSelectedAppDataResult { cleared })
}

#[tauri::command]
pub fn scan_cleanable_app_data(app: tauri::AppHandle) -> Result<CleanableScan, String> {
    let base = app_base_dir()?;
    let app_data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
    build_cleanable_scan(&base, &app_data_dir)
}

#[tauri::command]
pub fn clear_selected_app_data(
    input: ClearSelectedAppDataInput,
    app: tauri::AppHandle,
) -> Result<ClearSelectedAppDataResult, String> {
    let base = app_base_dir()?;
    let app_data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
    let ids = input
        .item_ids
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();
    clear_selected_app_data_impl(&base, &app_data_dir, &ids)
}

fn resolve_system_directory(
    base: &Path,
    app_data_dir: &Path,
    kind: &str,
) -> Result<PathBuf, String> {
    match kind {
        "data" => Ok(base.join("data")),
        "app_data" => Ok(app_data_dir.to_path_buf()),
        "output" => Ok(base.join("outputs")),
        "log" => Ok(base.join("logs")),
        _ => Err(format!("未知系统目录：{kind}")),
    }
}

#[tauri::command]
pub fn open_system_directory(app: tauri::AppHandle, kind: String) -> Result<(), String> {
    let base = app_base_dir()?;
    let app_data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
    let target = resolve_system_directory(&base, &app_data_dir, &kind)?;
    if !target.is_dir() {
        return Err(format!("系统目录不存在或不可用：{}", target.display()));
    }

    let mut command = if cfg!(target_os = "windows") {
        let mut command = Command::new("explorer.exe");
        command.arg(&target);
        command
    } else if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg(&target);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(&target);
        command
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("打开系统目录失败：{error}"))
}

#[tauri::command]
pub fn open_output_dir() -> Result<(), String> {
    let dir = output_dir_path()?;
    let mut cmd = if cfg!(target_os = "windows") {
        let mut command = Command::new("explorer.exe");
        command.arg(&dir);
        command
    } else if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg(&dir);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(&dir);
        command
    };

    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("打开输出目录失败: {e}"))
}

#[tauri::command]
pub fn path_exists(path: String) -> Result<bool, String> {
    Ok(PathBuf::from(path).exists())
}

#[tauri::command]
pub fn open_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let target = PathBuf::from(&path)
        .canonicalize()
        .map_err(|_| format!("文件不存在: {path}"))?;
    let app_data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
    let base = app_base_dir()?;
    ensure_path_under_roots(
        &target,
        &[
            base.join("data"),
            base.join("outputs"),
            base.join("logs"),
            app_data_dir,
        ],
    )?;
    if !is_openable_app_path(&target) {
        return Err("该文件类型不允许由应用打开".to_string());
    }

    let mut cmd = if cfg!(target_os = "windows") {
        if target.is_dir() {
            let mut command = Command::new("explorer.exe");
            command.arg(&target);
            command
        } else {
            let mut command = Command::new("powershell");
            command
                .args([
                    "-NoProfile",
                    "-Command",
                    "Start-Process -LiteralPath $env:AGENT_OPEN_PATH",
                ])
                .env("AGENT_OPEN_PATH", &target);
            command
        }
    } else if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg(&target);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(&target);
        command
    };

    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("打开文件失败: {e}"))
}

fn ensure_path_under_roots(target: &Path, roots: &[PathBuf]) -> Result<(), String> {
    for root in roots {
        if let Ok(root) = root.canonicalize() {
            if target.starts_with(root) {
                return Ok(());
            }
        }
    }
    Err("拒绝打开应用目录之外的路径".to_string())
}

fn is_openable_app_path(path: &Path) -> bool {
    if path.is_dir() {
        return true;
    }
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "md" | "markdown"
                    | "txt"
                    | "json"
                    | "csv"
                    | "pdf"
                    | "docx"
                    | "xlsx"
                    | "html"
                    | "png"
                    | "jpg"
                    | "jpeg"
                    | "gif"
                    | "webp"
            )
        })
}

fn path_to_string(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| format!("路径包含非 UTF-8 字符: {:?}", path))
}

fn is_inside_outputs(path: &Path) -> Result<bool, String> {
    let output_root = output_dir_path()?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let target = if path.exists() {
        path.canonicalize().map_err(|e| e.to_string())?
    } else {
        let parent = path
            .parent()
            .ok_or_else(|| "路径缺少父目录".to_string())?
            .canonicalize()
            .map_err(|e| e.to_string())?;
        parent.join(path.file_name().unwrap_or_default())
    };
    Ok(target.starts_with(output_root))
}

fn value_string(value: Option<&Value>) -> String {
    value
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string()
}

fn read_report(
    data_path: PathBuf,
    node_label_filter: Option<&str>,
) -> Result<Option<OutputReport>, String> {
    let text = fs::read_to_string(&data_path).map_err(|e| e.to_string())?;
    let value: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    if value.get("kind").and_then(|v| v.as_str()) != Some("agent-node-output") {
        return Ok(None);
    }

    let node = value.get("node").unwrap_or(&Value::Null);
    let node_label = value_string(node.get("label"));
    if let Some(filter) = node_label_filter {
        if node_label != filter {
            return Ok(None);
        }
    }

    let artifact = value.get("artifact").unwrap_or(&Value::Null);
    let artifact_path = value_string(artifact.get("path"));
    let folder = data_path
        .parent()
        .ok_or_else(|| "data.json 缺少父目录".to_string())?
        .to_path_buf();
    let canvas = value.get("canvas").unwrap_or(&Value::Null);
    let id = format!(
        "{}::{}",
        value_string(canvas.get("runId")),
        path_to_string(&folder)?
    );

    Ok(Some(OutputReport {
        id,
        canvas_name: value_string(canvas.get("name")),
        node_id: value_string(node.get("id")),
        node_label,
        output_format: value_string(node.get("outputFormat")),
        run_at: value_string(value.get("runAt")),
        summary: value_string(value.get("summary")),
        folder_path: path_to_string(&folder)?,
        artifact_name: value_string(artifact.get("name")),
        artifact_path,
        data_path: path_to_string(&data_path)?,
    }))
}

fn modified_or_epoch(path: &Path) -> SystemTime {
    path.metadata()
        .and_then(|m| m.modified())
        .unwrap_or(UNIX_EPOCH)
}

fn read_dir_sorted_desc(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut paths = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .map(|entry| entry.map(|e| e.path()).map_err(|e| e.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    paths.sort_by(|a, b| {
        modified_or_epoch(b)
            .cmp(&modified_or_epoch(a))
            .then_with(|| {
                b.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .cmp(&a.file_name().map(|n| n.to_string_lossy().to_string()))
            })
    });
    Ok(paths)
}

fn collect_recent_reports(
    root: &Path,
    node_label_filter: Option<&str>,
    reports: &mut Vec<OutputReport>,
) -> Result<(), String> {
    let mut stack = vec![root.to_path_buf()];
    let mut visited_dirs = 0usize;

    while let Some(dir) = stack.pop() {
        if reports.len() >= OUTPUT_REPORT_SCAN_TARGET || visited_dirs >= OUTPUT_REPORT_MAX_DIRS {
            break;
        }
        visited_dirs += 1;

        let mut child_dirs = Vec::new();
        for path in read_dir_sorted_desc(&dir)? {
            if reports.len() >= OUTPUT_REPORT_SCAN_TARGET {
                break;
            }
            if path.is_dir() {
                child_dirs.push(path);
            } else if path.file_name().and_then(|n| n.to_str()) == Some("data.json") {
                if let Some(report) = read_report(path, node_label_filter)? {
                    reports.push(report);
                }
            }
        }

        for child in child_dirs.into_iter().rev() {
            stack.push(child);
        }
    }

    Ok(())
}

#[tauri::command]
pub fn list_output_reports(node_label: Option<String>) -> Result<Vec<OutputReport>, String> {
    let root = output_dir_path()?;
    let mut reports = Vec::new();
    collect_recent_reports(&root, node_label.as_deref(), &mut reports)?;
    reports.sort_by(|a, b| b.run_at.cmp(&a.run_at));
    reports.truncate(OUTPUT_REPORT_LIMIT);
    Ok(reports)
}

#[tauri::command]
pub fn delete_output_report(paths: Vec<String>) -> Result<(), String> {
    for path in paths {
        let target = PathBuf::from(&path);
        if !is_inside_outputs(&target)? {
            return Err(format!("只能删除 outputs 目录内的报告文件: {path}"));
        }
        if target.exists() {
            if target.is_dir() {
                return Err("不支持直接删除目录".to_string());
            }
            fs::remove_file(&target).map_err(|e| e.to_string())?;
            let mut current = target.parent().map(|p| p.to_path_buf());
            while let Some(dir) = current {
                if !is_inside_outputs(&dir)? || dir == output_dir_path()? {
                    break;
                }
                match fs::remove_dir(&dir) {
                    Ok(()) => current = dir.parent().map(|p| p.to_path_buf()),
                    Err(_) => break,
                }
            }
        }
    }
    Ok(())
}

// key 白名单：只允许应用自己的存储键，防路径穿越 / 越权写盘。
#[tauri::command]
pub fn list_jizi_skill_files() -> Result<Vec<JiziSkillFile>, String> {
    let skills_root = user_skills_dir()?;
    if !skills_root.exists() {
        return Ok(Vec::new());
    }

    let mut skills = Vec::new();
    for entry in fs::read_dir(skills_root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }

        let Some(id) = dir.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !valid_skill_id(id) {
            continue;
        }

        let skill_path = dir.join("SKILL.md");
        if !skill_path.is_file() {
            continue;
        }

        let bytes = match fs::read(&skill_path) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        let content = String::from_utf8_lossy(&bytes).into_owned();
        skills.push(JiziSkillFile {
            id: id.to_string(),
            path: path_to_string(&skill_path)?,
            content,
        });
    }

    skills.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(skills)
}

fn yaml_line_value(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace(['\r', '\n'], " ")
            .trim()
    )
}

fn markdown_list(items: &[String]) -> String {
    items
        .iter()
        .map(|item| format!("- {}", item.trim()))
        .collect::<Vec<_>>()
        .join("\n")
}

#[tauri::command]
pub fn save_jizi_skill_file(
    id: String,
    title: String,
    description: String,
    category: String,
    capabilities: Vec<String>,
    instructions: String,
) -> Result<(), String> {
    let (skill_path, content, id_label) =
        build_jizi_skill_artifacts(id, title, description, category, capabilities, instructions)?;
    if skill_path.exists() {
        return Err(format!("skill「{id_label}」已存在"));
    }
    atomic_write(&skill_path, &content)?;
    Ok(())
}

#[tauri::command]
pub fn overwrite_jizi_skill_file(
    id: String,
    title: String,
    description: String,
    category: String,
    capabilities: Vec<String>,
    instructions: String,
) -> Result<(), String> {
    let (skill_path, content, _id_label) =
        build_jizi_skill_artifacts(id, title, description, category, capabilities, instructions)?;
    backup_existing_skill_file(&skill_path)?;
    atomic_write(&skill_path, &content)?;
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiziSkillWriteInput {
    id: String,
    title: String,
    description: String,
    category: String,
    capabilities: Vec<String>,
    instructions: String,
    overwrite: bool,
}

#[tauri::command]
pub fn write_jizi_skill_files(items: Vec<JiziSkillWriteInput>) -> Result<(), String> {
    if items.is_empty() {
        return Err("没有要写入的 Skill".to_string());
    }
    if items.len() > 50 {
        return Err("一次最多写入 50 个 Skill".to_string());
    }

    let mut prepared = Vec::with_capacity(items.len());
    let mut ids = std::collections::HashSet::new();
    for item in items {
        let (path, content, id) = build_jizi_skill_artifacts(
            item.id,
            item.title,
            item.description,
            item.category,
            item.capabilities,
            item.instructions,
        )?;
        if !ids.insert(id.clone()) {
            return Err(format!("本批次包含重复 Skill 索引「{id}」"));
        }
        if path.exists() && !item.overwrite {
            return Err(format!("skill「{id}」已存在"));
        }
        prepared.push((path, content));
    }

    write_prepared_skill_transaction(&prepared)
}

fn backup_existing_skill_file(path: &Path) -> Result<(), String> {
    if path.exists() {
        let backup_path = path.with_extension("md.bak");
        fs::copy(path, backup_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn write_prepared_skill_transaction(prepared: &[(PathBuf, String)]) -> Result<(), String> {
    let snapshots = prepared
        .iter()
        .map(|(path, _)| {
            if path.exists() {
                fs::read_to_string(path)
                    .map(Some)
                    .map_err(|e| e.to_string())
            } else {
                Ok(None)
            }
        })
        .collect::<Result<Vec<_>, String>>()?;

    for (path, _) in prepared.iter() {
        backup_existing_skill_file(path)?;
    }

    for (index, (path, content)) in prepared.iter().enumerate() {
        if let Err(error) = atomic_write(path, content) {
            for rollback_index in 0..=index {
                let rollback_path = &prepared[rollback_index].0;
                match &snapshots[rollback_index] {
                    Some(previous) => {
                        let _ = atomic_write(rollback_path, previous);
                    }
                    None => {
                        let _ = fs::remove_file(rollback_path);
                        if let Some(parent) = rollback_path.parent() {
                            let _ = fs::remove_dir(parent);
                        }
                    }
                }
            }
            return Err(format!("批量写入失败，已回滚: {error}"));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn delete_jizi_skill_file(id: String) -> Result<(), String> {
    let id = id.trim();
    if !valid_skill_id(id) {
        return Err("Skill 索引格式不正确".to_string());
    }
    let dir = user_skills_dir()?.join(id);
    let path = dir.join("SKILL.md");
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    if dir.exists() {
        fs::remove_dir(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown")
        })
}

// 用于 Skill 导入，只读取用户通过原生对话框明确选择的 Markdown 文件。
#[tauri::command]
pub fn read_text_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    const MAX: usize = 2 * 1024 * 1024;
    let path = PathBuf::from(path)
        .canonicalize()
        .map_err(|_| "文件不存在".to_string())?;
    if !is_markdown_path(&path) {
        return Err("仅支持导入 Markdown 文件".to_string());
    }
    let scope = app
        .try_fs_scope()
        .ok_or_else(|| "文件访问权限未初始化".to_string())?;
    if !scope.is_allowed(&path) {
        return Err("请通过文件选择器选择要导入的文件".to_string());
    }

    let mut file = fs::File::open(&path).map_err(|error| error.to_string())?;
    if !file
        .metadata()
        .map_err(|error| error.to_string())?
        .is_file()
    {
        return Err("所选路径不是普通文件".to_string());
    }
    let mut bytes = Vec::new();
    Read::take(&mut file, (MAX + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() > MAX {
        return Err("文件过大，请控制在 2MB 以内".to_string());
    }
    String::from_utf8(bytes).map_err(|_| "文件不是有效的 UTF-8 文本".to_string())
}

fn build_jizi_skill_artifacts(
    id: String,
    title: String,
    description: String,
    category: String,
    capabilities: Vec<String>,
    instructions: String,
) -> Result<(std::path::PathBuf, String, String), String> {
    let id = id.trim().to_string();
    if !valid_skill_id(&id) {
        return Err(
            "skill 标识只能使用小写字母、数字和连字符，且不能以连字符开头或结尾".to_string(),
        );
    }
    let title = title.trim();
    let description = description.trim();
    let category = category.trim();
    if !matches!(
        category,
        "workflow" | "tool" | "diagnosis" | "model" | "skill"
    ) {
        return Err("skill 分类不正确".to_string());
    }
    let capabilities = capabilities
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();
    let instructions = instructions.trim();
    if title.is_empty()
        || description.is_empty()
        || capabilities.is_empty()
        || instructions.is_empty()
    {
        return Err("名称、描述、具体能力和做事方法不能为空".to_string());
    }
    if instructions.chars().count() > 20_000 {
        return Err("skill 正文过长，请控制在 20000 个字符以内".to_string());
    }
    if description.chars().count() > 1_000 {
        return Err("skill 描述过长，请控制在 1000 个字符以内".to_string());
    }
    if title.chars().count() > 100 {
        return Err("skill 名称过长，请控制在 100 个字符以内".to_string());
    }
    if capabilities.len() < 3 || capabilities.len() > 8 {
        return Err("skill 具体能力应保持在 3-8 条".to_string());
    }
    if capabilities.iter().any(|item| item.chars().count() > 100) {
        return Err("skill 单条能力过长，请控制在 100 个字符以内".to_string());
    }

    let skills_root = user_skills_dir()?;
    let skill_dir = skills_root.join(&id);
    fs::create_dir_all(&skill_dir).map_err(|e| e.to_string())?;
    let skill_path = skill_dir.join("SKILL.md");
    let capability_text = capabilities.join(" | ");
    let capability_markdown = markdown_list(&capabilities);
    let content = format!(
        concat!(
            "---\n",
            "index: {index}\n",
            "title: {title}\n",
            "description: {description}\n",
            "category: {category}\n",
            "capabilities: {capability_text}\n",
            "---\n\n",
            "# {title}\n\n",
            "## 具体能力\n\n",
            "{capability_markdown}\n\n",
            "## 做事方法\n\n",
            "{instructions}\n"
        ),
        index = yaml_line_value(&id),
        title = yaml_line_value(title),
        description = yaml_line_value(description),
        category = yaml_line_value(category),
        capability_text = yaml_line_value(&capability_text),
        capability_markdown = capability_markdown,
        instructions = instructions
    );
    Ok((skill_path, content, id))
}

fn resolve(key: &str) -> Result<PathBuf, String> {
    // L24 修复：key 长度上限
    if key.len() > MAX_KEY_LEN {
        return Err(format!("存储键过长（最大 {MAX_KEY_LEN} 字符）: {key}"));
    }
    let valid = key.starts_with("multi-agent-")
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !valid {
        return Err(format!("非法存储键: {key}"));
    }
    Ok(data_dir()?.join(format!("{key}.json")))
}

#[tauri::command]
pub fn storage_get(key: String) -> Result<Option<String>, String> {
    let path = resolve(&key)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn storage_set(key: String, value: String) -> Result<(), String> {
    // M12 修复：value 大小上限
    if value.len() > MAX_VALUE_SIZE {
        return Err(format!(
            "存储值过大（{} MB），超过 {} MB 上限",
            value.len() / 1024 / 1024,
            MAX_VALUE_SIZE / 1024 / 1024
        ));
    }
    let path = resolve(&key)?;

    // 写前若目标已存在,先覆盖式备份一份 .bak(只留最新一份,不按时间戳堆积),
    // 万一新内容逻辑写错还有回滚机会。备份失败不阻断主写入(尽力而为)。
    if path.exists() {
        let bak = path.with_extension("bak");
        let _ = fs::copy(&path, &bak);
    }

    atomic_write(&path, &value)
}

// 原子写:先写同目录临时文件再 rename 替换(同卷 rename 原子),
// 避免进程崩溃/断电时目标文件被写成半截损坏的 JSON。
// P2-3:临时文件名加 pid+线程 id+单调计数,保证同一 key 并发写各用独立临时文件——
// 否则共享固定 .tmp 会互相覆盖,导致 rename 拿到别人的内容或 ENOENT 失败(最后值倒退/损坏)。
fn atomic_write(path: &Path, value: &str) -> Result<(), String> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static WRITE_SEQ: AtomicU64 = AtomicU64::new(0);
    let seq = WRITE_SEQ.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();
    // 线程 id 无稳定数值接口,用其 Debug 表示(形如 ThreadId(3))提取唯一片段即可。
    let tid = format!("{:?}", std::thread::current().id());
    let tid: String = tid.chars().filter(|c| c.is_ascii_digit()).collect();
    let unique = format!("{pid}-{tid}-{seq}.tmp");
    let tmp = path.with_extension(unique);

    fs::write(&tmp, value).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| {
        // rename 失败时清理临时文件,避免残留
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

#[tauri::command]
pub fn storage_remove(key: String) -> Result<(), String> {
    let path = resolve(&key)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    let backup = path.with_extension("bak");
    if backup.exists() {
        fs::remove_file(&backup).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};

    #[test]
    fn directory_usage_counts_nested_files() {
        let root = temp_dir("system-snapshot-size");
        fs::create_dir_all(root.join("nested")).unwrap();
        fs::write(root.join("a.bin"), [0_u8; 3]).unwrap();
        fs::write(root.join("nested").join("b.bin"), [0_u8; 5]).unwrap();

        let usage = directory_usage_with_limits(&root, 20_000, 64);

        assert_eq!(usage.bytes, 8);
        assert!(usage.complete, "{}", usage.detail);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn directory_usage_marks_entry_limit_incomplete() {
        let root = temp_dir("system-snapshot-entry-limit");
        fs::write(root.join("a.bin"), [0_u8; 1]).unwrap();
        fs::write(root.join("b.bin"), [0_u8; 1]).unwrap();
        fs::write(root.join("c.bin"), [0_u8; 1]).unwrap();

        let usage = directory_usage_with_limits(&root, 2, 64);

        assert_eq!(usage.bytes, 2);
        assert!(!usage.complete);
        assert!(usage.detail.contains("条目上限"), "{}", usage.detail);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn directory_usage_applies_entry_limit_across_nested_directories() {
        let root = temp_dir("system-snapshot-global-entry-limit");
        fs::create_dir_all(root.join("first")).unwrap();
        fs::create_dir_all(root.join("second")).unwrap();
        fs::write(root.join("first").join("a.bin"), [0_u8; 1]).unwrap();
        fs::write(root.join("second").join("b.bin"), [0_u8; 1]).unwrap();

        let usage = directory_usage_with_limits(&root, 2, 64);

        assert!(!usage.complete);
        assert!(usage.detail.contains("条目上限"), "{}", usage.detail);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn directory_usage_marks_byte_overflow_incomplete() {
        let mut bytes = u64::MAX - 1;
        let mut complete = true;
        let mut details = Vec::new();

        add_directory_usage_bytes(&mut bytes, 2, &mut complete, &mut details);

        assert_eq!(bytes, u64::MAX);
        assert!(!complete);
        assert!(details.join("；").contains("大小上限"));
    }

    #[test]
    fn directory_usage_marks_depth_limit_incomplete() {
        let root = temp_dir("system-snapshot-depth-limit");
        fs::create_dir_all(root.join("nested").join("deeper")).unwrap();
        fs::write(
            root.join("nested").join("deeper").join("value.bin"),
            [0_u8; 5],
        )
        .unwrap();

        let usage = directory_usage_with_limits(&root, 20_000, 1);

        assert_eq!(usage.bytes, 0);
        assert!(!usage.complete);
        assert!(usage.detail.contains("深度上限"), "{}", usage.detail);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn release_system_checks_omit_development_scripts() {
        let root = temp_dir("system-snapshot-release-checks");
        let data = root.join("data");
        let app_data = root.join("app-data");
        let output = root.join("outputs");
        let log = root.join("logs");

        let checks = build_system_checks(&root, &data, &app_data, &output, &log, false);

        assert!(checks
            .iter()
            .all(|check| check.id != "environment-configurator"));
        assert!(checks.iter().all(|check| check.id != "launch-preflight"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unknown_system_directory_kind_is_rejected() {
        let base = PathBuf::from("base");
        let app_data = PathBuf::from("app-data");

        let error = resolve_system_directory(&base, &app_data, "secrets").unwrap_err();

        assert!(error.contains("未知系统目录"), "{error}");
    }

    #[test]
    fn open_path_roots_accept_nested_paths_and_reject_siblings() {
        let root = temp_dir("open-path-root");
        let allowed = root.join("allowed");
        let nested = allowed.join("nested");
        let sibling = root.join("sibling");
        fs::create_dir_all(&nested).unwrap();
        fs::create_dir_all(&sibling).unwrap();

        let nested = nested.canonicalize().unwrap();
        assert!(ensure_path_under_roots(&nested, std::slice::from_ref(&allowed)).is_ok());
        assert!(ensure_path_under_roots(&sibling.canonicalize().unwrap(), &[allowed]).is_err());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn skill_import_only_accepts_markdown_extensions() {
        assert!(is_markdown_path(Path::new("skill.md")));
        assert!(is_markdown_path(Path::new("skill.MARKDOWN")));
        assert!(!is_markdown_path(Path::new("skill.txt")));
        assert!(!is_markdown_path(Path::new("skill.md.exe")));
    }

    #[test]
    fn open_path_rejects_executable_file_types() {
        assert!(is_openable_app_path(Path::new("report.md")));
        assert!(is_openable_app_path(Path::new("workbook.XLSX")));
        assert!(!is_openable_app_path(Path::new("payload.exe")));
        assert!(!is_openable_app_path(Path::new("payload.ps1")));
        assert!(!is_openable_app_path(Path::new("payload.lnk")));
        assert!(!is_openable_app_path(Path::new("no-extension")));
    }

    #[test]
    fn directory_write_probe_is_removed_after_success() {
        let root = temp_dir("system-snapshot-write-probe");

        probe_directory_writable(&root).unwrap();

        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn directory_write_probe_does_not_accumulate_when_cleanup_is_denied() {
        let root = temp_dir("system-snapshot-write-probe-cleanup-denied");
        let deny_cleanup = |_probe: &Path| -> std::io::Result<()> {
            Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "cleanup denied",
            ))
        };

        let first_error = probe_directory_writable_with_remover(&root, &deny_cleanup).unwrap_err();
        let second_error = probe_directory_writable_with_remover(&root, &deny_cleanup).unwrap_err();
        let entries: Vec<_> = fs::read_dir(&root)
            .unwrap()
            .map(|entry| entry.unwrap())
            .collect();

        assert!(first_error.contains("删除写入探针失败"), "{first_error}");
        assert!(
            second_error.contains("清理旧写入探针失败"),
            "{second_error}"
        );
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0].file_name().to_string_lossy(),
            ".system-write-probe.tmp"
        );

        fs::remove_file(entries[0].path()).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn directory_write_probe_serializes_concurrent_checks_for_same_directory() {
        let root = Arc::new(temp_dir("system-snapshot-write-probe-concurrent"));
        let barrier = Arc::new(Barrier::new(8));
        let handles: Vec<_> = (0..8)
            .map(|_| {
                let root = Arc::clone(&root);
                let barrier = Arc::clone(&barrier);
                std::thread::spawn(move || {
                    barrier.wait();
                    probe_directory_writable(&root)
                })
            })
            .collect();

        for handle in handles {
            handle.join().unwrap().unwrap();
        }
        assert_eq!(fs::read_dir(root.as_path()).unwrap().count(), 0);

        fs::remove_dir_all(root.as_path()).unwrap();
    }

    #[test]
    fn cleanable_scan_marks_defaults_and_important_categories() {
        let root = temp_dir("cleanable_scan");
        let data = root.join("data");
        let outputs = root.join("outputs");
        let logs = root.join("logs");
        let app_data = root.join("app-data");
        fs::create_dir_all(&data).unwrap();
        fs::create_dir_all(&outputs).unwrap();
        fs::create_dir_all(&logs).unwrap();
        fs::create_dir_all(&app_data).unwrap();
        fs::write(outputs.join("report.md"), "output").unwrap();
        fs::write(logs.join("tauri.log"), "log").unwrap();
        fs::write(data.join("multi-agent-token-stats.json"), "stats").unwrap();
        fs::write(data.join("multi-agent-ui.json"), "ui").unwrap();
        fs::write(data.join("multi-agent-canvas.json"), "canvas").unwrap();
        fs::write(data.join("multi-agent-agents.json"), "agents").unwrap();
        fs::write(data.join("multi-agent-fictionist-index.json"), "fictionist").unwrap();
        fs::write(data.join("multi-agent-master.json"), "master").unwrap();
        fs::write(data.join("multi-agent-tools.json"), "tools").unwrap();
        fs::write(data.join("multi-agent-models.json"), "models").unwrap();
        fs::write(data.join("multi-agent-search.json"), "search").unwrap();
        fs::create_dir_all(app_data.join("python-tools")).unwrap();
        fs::create_dir_all(app_data.join("skills")).unwrap();
        fs::write(app_data.join("python-tools/registry.json"), "tools").unwrap();
        fs::write(app_data.join("skills/custom.md"), "skill").unwrap();
        fs::write(app_data.join("extension-cache.json"), "cache").unwrap();

        let scan = build_cleanable_scan(&root, &app_data).unwrap();

        assert_eq!(scan.items.len(), 10);
        for id in ["outputs", "logs", "runtime", "ui"] {
            let item = scan.items.iter().find(|item| item.id == id).unwrap();
            assert!(item.default_selected, "{id} 应默认选中");
            assert!(!item.important, "{id} 不应标记重要");
            assert!(item.exists, "{id} 应存在");
        }
        for id in [
            "canvas_agents",
            "fictionist",
            "jizi",
            "tools_app_data",
            "user_skills",
            "model_search",
        ] {
            let item = scan.items.iter().find(|item| item.id == id).unwrap();
            assert!(!item.default_selected, "{id} 不应默认选中");
            assert!(item.important, "{id} 应标记重要");
            assert!(item.exists, "{id} 应存在");
        }

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cleanable_scan_includes_fictionist_data() {
        let root = temp_dir("cleanable_scan_fictionist");
        let data = root.join("data");
        let app_data = root.join("app-data");
        fs::create_dir_all(&data).unwrap();
        fs::create_dir_all(&app_data).unwrap();
        let fictionist_files = [
            "multi-agent-fictionist-index.json",
            "multi-agent-fictionist-chapter-chapter-1.json",
            "multi-agent-fictionist-index.bak",
            "multi-agent-fictionist-chapter-chapter-1.12-3-4.tmp",
        ];
        for name in fictionist_files {
            fs::write(data.join(name), "fictionist").unwrap();
        }
        fs::write(data.join("multi-agent-canvas.json"), "canvas").unwrap();
        fs::write(data.join("multi-agent-fictionist-keep.txt"), "not managed").unwrap();

        let scan = build_cleanable_scan(&root, &app_data).unwrap();
        let item = scan
            .items
            .iter()
            .find(|item| item.id == "fictionist")
            .unwrap();

        assert!(item.exists);
        assert!(item.important);
        assert!(!item.default_selected);
        assert_eq!(item.usage.bytes, 40);

        clear_selected_app_data_impl(&root, &app_data, &["fictionist"]).unwrap();

        for name in fictionist_files {
            assert!(!data.join(name).exists(), "{name} 应被清理");
        }
        assert!(data.join("multi-agent-canvas.json").exists());
        assert!(data.join("multi-agent-fictionist-keep.txt").exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn clear_selected_tools_and_skills_preserves_other_app_data() {
        let root = temp_dir("clear_selected_extensions");
        let data = root.join("data");
        let app_data = root.join("app-data");
        let tools = app_data.join("python-tools");
        let skills = app_data.join("skills");
        fs::create_dir_all(&data).unwrap();
        fs::create_dir_all(&tools).unwrap();
        fs::create_dir_all(&skills).unwrap();
        fs::write(data.join("multi-agent-tools.json"), "tools").unwrap();
        fs::write(tools.join("registry.json"), "registry").unwrap();
        fs::write(skills.join("custom.md"), "skill").unwrap();
        fs::write(app_data.join("future-data.json"), "keep").unwrap();

        clear_selected_app_data_impl(&root, &app_data, &["tools_app_data"]).unwrap();

        assert!(!data.join("multi-agent-tools.json").exists());
        assert!(fs::read_dir(&tools).unwrap().next().is_none());
        assert!(skills.join("custom.md").exists());
        assert!(app_data.join("future-data.json").exists());

        fs::write(tools.join("registry.json"), "registry").unwrap();
        clear_selected_app_data_impl(&root, &app_data, &["user_skills"]).unwrap();

        assert!(fs::read_dir(&skills).unwrap().next().is_none());
        assert!(tools.join("registry.json").exists());
        assert!(app_data.join("future-data.json").exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn clear_selected_app_data_removes_only_selected_categories() {
        let root = temp_dir("clear_selected_outputs_logs");
        let data = root.join("data");
        let outputs = root.join("outputs");
        let logs = root.join("logs");
        let app_data = root.join("app-data");
        fs::create_dir_all(&data).unwrap();
        fs::create_dir_all(&outputs).unwrap();
        fs::create_dir_all(&logs).unwrap();
        fs::create_dir_all(&app_data).unwrap();
        fs::write(outputs.join("report.md"), "output").unwrap();
        fs::write(logs.join("tauri.log"), "log").unwrap();
        fs::write(data.join("crash.log"), "crash").unwrap();
        fs::write(data.join("multi-agent-canvas.json"), "canvas").unwrap();
        fs::write(data.join("multi-agent-models.json"), "models").unwrap();
        fs::write(data.join("multi-agent-search.json"), "search").unwrap();

        let result = clear_selected_app_data_impl(&root, &app_data, &["outputs", "logs"]).unwrap();

        assert_eq!(
            result.cleared,
            vec!["outputs".to_string(), "logs".to_string()]
        );
        assert!(fs::read_dir(&outputs).unwrap().next().is_none());
        assert!(fs::read_dir(&logs).unwrap().next().is_none());
        assert!(!data.join("crash.log").exists());
        assert!(data.join("multi-agent-canvas.json").exists());
        assert!(data.join("multi-agent-models.json").exists());
        assert!(data.join("multi-agent-search.json").exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn clear_selected_app_data_removes_important_categories_only_when_selected() {
        let root = temp_dir("clear_selected_important");
        let data = root.join("data");
        let app_data = root.join("app-data");
        fs::create_dir_all(&data).unwrap();
        fs::create_dir_all(&app_data).unwrap();
        fs::write(data.join("multi-agent-canvas.json"), "canvas").unwrap();
        fs::write(data.join("multi-agent-canvas.bak"), "canvas backup").unwrap();
        fs::write(data.join("multi-agent-agents.json"), "agents").unwrap();
        fs::write(data.join("multi-agent-models.json"), "models").unwrap();
        fs::write(data.join("multi-agent-search.json"), "search").unwrap();

        clear_selected_app_data_impl(&root, &app_data, &["canvas_agents"]).unwrap();

        assert!(!data.join("multi-agent-canvas.json").exists());
        assert!(!data.join("multi-agent-canvas.bak").exists());
        assert!(!data.join("multi-agent-agents.json").exists());
        assert!(data.join("multi-agent-models.json").exists());
        assert!(data.join("multi-agent-search.json").exists());

        clear_selected_app_data_impl(&root, &app_data, &["model_search"]).unwrap();

        assert!(!data.join("multi-agent-models.json").exists());
        assert!(!data.join("multi-agent-search.json").exists());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn clear_selected_app_data_rejects_unknown_category() {
        let root = temp_dir("clear_selected_unknown");
        let app_data = root.join("app-data");
        fs::create_dir_all(&app_data).unwrap();

        let error = clear_selected_app_data_impl(&root, &app_data, &["unknown"]).unwrap_err();

        assert!(error.contains("未知清理分类"), "{error}");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn skill_limits_count_unicode_characters_not_utf8_bytes() {
        assert_eq!("汉".repeat(20_000).chars().count(), 20_000);
        assert!("汉".repeat(20_000).len() > 20_000);
        assert_eq!("😀".repeat(1_000).chars().count(), 1_000);
    }

    #[test]
    fn legacy_skill_migration_preserves_newer_target_files() {
        let root = temp_dir("skill_migration");
        let legacy = root.join("legacy");
        let target = root.join("target");
        fs::create_dir_all(legacy.join("custom-skill")).unwrap();
        fs::create_dir_all(target.join("custom-skill")).unwrap();
        fs::create_dir_all(legacy.join("second-skill")).unwrap();
        fs::write(legacy.join("custom-skill/SKILL.md"), "legacy").unwrap();
        fs::write(target.join("custom-skill/SKILL.md"), "newer").unwrap();
        fs::write(legacy.join("second-skill/SKILL.md"), "second").unwrap();

        migrate_legacy_skills(&legacy, &target).unwrap();

        assert_eq!(
            fs::read_to_string(target.join("custom-skill/SKILL.md")).unwrap(),
            "newer"
        );
        assert_eq!(
            fs::read_to_string(target.join("second-skill/SKILL.md")).unwrap(),
            "second"
        );
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn batch_skill_write_rolls_back_when_a_later_write_fails() {
        let root = temp_dir("skill_transaction");
        let first = root.join("first/SKILL.md");
        fs::create_dir_all(first.parent().unwrap()).unwrap();
        let impossible = root.join("missing-parent/SKILL.md");
        let prepared = vec![
            (first.clone(), "first".to_string()),
            (impossible, "second".to_string()),
        ];

        assert!(write_prepared_skill_transaction(&prepared).is_err());
        assert!(!first.exists(), "首项必须在后续写入失败时回滚");
        fs::remove_dir_all(root).ok();
    }

    // 用系统临时目录建唯一子目录,绝不碰真实 data/。
    fn temp_dir(tag: &str) -> PathBuf {
        let base = std::env::temp_dir().join(format!(
            "agent_collab_storage_test_{tag}_{}_{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&base).unwrap();
        base
    }

    // 每个线程写一个定长、可辨识的合法 JSON;撕裂/半截内容都不会等于任何候选值。
    fn candidate(i: usize) -> String {
        format!("{{\"v\":{i:04},\"pad\":\"{}\"}}", "x".repeat(64))
    }

    // P2-3 修复后的写:N 个线程并发写同一路径,断言零写失败且终值恰为某个候选值。
    // 语义 = 最后一次写入胜出,终态必须是完整、合法的某次写入,绝不撕裂。
    #[test]
    fn atomic_write_concurrent_same_path_final_state_correct() {
        let dir = temp_dir("fixed");
        let path = dir.join("multi-agent-canvases.json");
        let threads = 16usize;
        let rounds = 40usize;
        let candidates: Vec<String> = (0..threads).map(candidate).collect();

        for _ in 0..rounds {
            let barrier = Arc::new(Barrier::new(threads));
            let handles: Vec<_> = (0..threads)
                .map(|i| {
                    let path = path.clone();
                    let value = candidates[i].clone();
                    let barrier = Arc::clone(&barrier);
                    std::thread::spawn(move || {
                        barrier.wait(); // 尽量对齐起跑,放大重叠
                        atomic_write(&path, &value)
                    })
                })
                .collect();

            let mut errors = 0usize;
            for h in handles {
                if h.join().unwrap().is_err() {
                    errors += 1;
                }
            }
            // 独立临时文件后,rename 各自独立,不应有并发写失败。
            assert_eq!(errors, 0, "修复后不应出现并发写失败");

            let final_content = fs::read_to_string(&path).unwrap();
            assert!(
                candidates.contains(&final_content),
                "终值必须是某次完整写入,不能撕裂: {final_content:?}"
            );
        }

        // 不应残留任何临时文件。
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n != "multi-agent-canvases.json")
            .collect();
        assert!(leftovers.is_empty(), "不应残留临时文件: {leftovers:?}");

        fs::remove_dir_all(&dir).ok();
    }

    // 观察性测试:复刻修复前「共享固定 .tmp」写法,记录并发下的写失败/撕裂次数。
    // 用来验证 P2-3 的 race 真实存在(留档说明修复动机),不对复现次数做硬断言避免偶发误报。
    #[test]
    fn shared_tmp_race_is_observable() {
        fn shared_tmp_write(path: &Path, value: &str) -> Result<(), String> {
            let tmp = path.with_extension("tmp"); // 修复前:同 key 共享同一临时文件
            fs::write(&tmp, value).map_err(|e| e.to_string())?;
            fs::rename(&tmp, path).map_err(|e| {
                let _ = fs::remove_file(&tmp);
                e.to_string()
            })
        }

        let dir = temp_dir("shared");
        let path = dir.join("multi-agent-canvases.json");
        let threads = 16usize;
        let rounds = 60usize;
        let candidates: Vec<String> = (0..threads).map(candidate).collect();

        let mut total_errors = 0usize;
        let mut total_corruptions = 0usize;

        for _ in 0..rounds {
            let barrier = Arc::new(Barrier::new(threads));
            let handles: Vec<_> = (0..threads)
                .map(|i| {
                    let path = path.clone();
                    let value = candidates[i].clone();
                    let barrier = Arc::clone(&barrier);
                    std::thread::spawn(move || {
                        barrier.wait();
                        shared_tmp_write(&path, &value)
                    })
                })
                .collect();

            for h in handles {
                if h.join().unwrap().is_err() {
                    total_errors += 1;
                }
            }
            let final_content = fs::read_to_string(&path).unwrap_or_default();
            if !candidates.contains(&final_content) {
                total_corruptions += 1;
            }
        }

        println!(
            "[P2-3 观察] 共享固定 .tmp:{rounds} 轮 × {threads} 线程 → 写失败 {total_errors} 次,终值撕裂/异常 {total_corruptions} 轮"
        );
        fs::remove_dir_all(&dir).ok();
    }
}

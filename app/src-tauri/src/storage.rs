use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use serde::Serialize;
use serde_json::Value;

// M12 修复：value 大小上限（10 MB），防止单次写盘超大 JSON 导致磁盘耗尽
const MAX_VALUE_SIZE: usize = 10 * 1024 * 1024; // 10 MB

// M12 修复：key 长度上限，防止超过 Windows MAX_PATH (260)
// L24: storage key 无长度限制，极长 key 会超出 OS 路径限制
const MAX_KEY_LEN: usize = 100;

const OUTPUT_REPORT_LIMIT: usize = 80;
const OUTPUT_REPORT_SCAN_TARGET: usize = 200;
const OUTPUT_REPORT_MAX_DIRS: usize = 5000;

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

// 数据根目录:所有 store 的 JSON 都存在这里,随项目文件夹迁移。
// 开发期 = 项目顶层 <项目根>/data(CARGO_MANIFEST_DIR 指向 app/src-tauri,上溯两级到项目根)。
// 打包后 = 可执行文件同级 data(便携版:exe 与 data 一起压缩带走)。
// M12 修复：data_dir() 只在第一次被调用时创建目录（通过 OnceLock 缓存路径），
// 避免每次 storage_get/set/remove 都触发 create_dir_all syscall。
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

static DATA_DIR_CACHE: OnceLock<Result<PathBuf, String>> = OnceLock::new();

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
pub fn open_path(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err(format!("文件不存在: {path}"));
    }

    let mut cmd = if cfg!(target_os = "windows") {
        if target.is_dir() {
            let mut command = Command::new("explorer.exe");
            command.arg(&path);
            command
        } else {
            let mut command = Command::new("powershell");
            command
                .args(["-NoProfile", "-Command", "Start-Process -LiteralPath $env:AGENT_OPEN_PATH"])
                .env("AGENT_OPEN_PATH", &path);
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

fn path_to_string(path: &PathBuf) -> Result<String, String> {
    path.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| format!("路径包含非 UTF-8 字符: {:?}", path))
}

fn is_inside_outputs(path: &PathBuf) -> Result<bool, String> {
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
    value.and_then(|v| v.as_str()).unwrap_or_default().to_string()
}

fn read_report(data_path: PathBuf, node_label_filter: Option<&str>) -> Result<Option<OutputReport>, String> {
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

fn modified_or_epoch(path: &PathBuf) -> SystemTime {
    path.metadata()
        .and_then(|m| m.modified())
        .unwrap_or(UNIX_EPOCH)
}

fn read_dir_sorted_desc(dir: &PathBuf) -> Result<Vec<PathBuf>, String> {
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
    root: &PathBuf,
    node_label_filter: Option<&str>,
    reports: &mut Vec<OutputReport>,
) -> Result<(), String> {
    let mut stack = vec![root.clone()];
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
    let skills_root = app_base_dir()?.join("jizi-agent-architecture").join("skills");
    if !skills_root.exists() {
        return Ok(Vec::new());
    }

    let mut skills = Vec::new();
    for entry in fs::read_dir(&skills_root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }

        let Some(id) = dir.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        {
            continue;
        }

        let skill_path = dir.join("SKILL.md");
        if !skill_path.is_file() {
            continue;
        }

        let content = fs::read_to_string(&skill_path).map_err(|e| e.to_string())?;
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
            .replace('\r', " ")
            .replace('\n', " ")
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
    display_title: String,
    display_description: String,
    model_name: String,
    model_description: String,
    capabilities: Vec<String>,
    instructions: String,
) -> Result<(), String> {
    let id = id.trim();
    if id.len() < 2 || id.len() > 48 {
        return Err("skill 标识长度应为 2-48 个字符".to_string());
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        || id.starts_with('-')
        || id.ends_with('-')
    {
        return Err("skill 标识只能使用小写字母、数字和连字符，且不能以连字符开头或结尾".to_string());
    }
    let display_title = display_title.trim();
    let display_description = display_description.trim();
    let model_name = model_name.trim();
    if model_name.len() < 2 || model_name.len() > 64 {
        return Err("英文识别名长度应为 2-64 个字符".to_string());
    }
    if !model_name
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        || model_name.starts_with('-')
        || model_name.ends_with('-')
    {
        return Err("英文识别名只能使用小写字母、数字和连字符，且不能以连字符开头或结尾".to_string());
    }
    let model_description = model_description.trim();
    let capabilities = capabilities
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .take(20)
        .collect::<Vec<_>>();
    let instructions = instructions.trim();
    if display_title.is_empty()
        || display_description.is_empty()
        || model_description.is_empty()
        || capabilities.is_empty()
        || instructions.is_empty()
    {
        return Err("中文展示、模型说明、具体能力和做事方法不能为空".to_string());
    }
    if instructions.len() > 24_000 {
        return Err("skill 内容过长，请控制在 24000 字符以内".to_string());
    }
    if display_description.len() > 1_000 || model_description.len() > 2_000 {
        return Err("skill 描述过长，请再压缩一下".to_string());
    }

    let skills_root = app_base_dir()?.join("jizi-agent-architecture").join("skills");
    let skill_dir = skills_root.join(id);
    fs::create_dir_all(&skill_dir).map_err(|e| e.to_string())?;
    let skill_path = skill_dir.join("SKILL.md");
    if skill_path.exists() {
        return Err(format!("skill「{id}」已存在"));
    }
    let capability_text = capabilities.join(" | ");
    let capability_markdown = markdown_list(&capabilities);
    let content = format!(
        concat!(
            "---\n",
            "name: {model_name}\n",
            "description: {model_description}\n",
            "display_title: {display_title}\n",
            "display_description: {display_description}\n",
            "capabilities: {capability_text}\n",
            "---\n\n",
            "# {display_title}\n\n",
            "## Capabilities\n\n",
            "{capability_markdown}\n\n",
            "## Instructions\n\n",
            "{instructions}\n"
        ),
        model_name = model_name,
        model_description = yaml_line_value(model_description),
        display_title = yaml_line_value(display_title),
        display_description = yaml_line_value(display_description),
        capability_text = yaml_line_value(&capability_text),
        capability_markdown = capability_markdown,
        instructions = instructions
    );
    fs::write(&skill_path, content).map_err(|e| e.to_string())?;
    Ok(())
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
    fs::read_to_string(&path).map(Some).map_err(|e| e.to_string())
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
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};

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

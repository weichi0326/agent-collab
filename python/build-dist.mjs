// Python 可分发环境组装脚本（发版时运行一次，需联网）。
//
// 产出：app/src-tauri/python-dist/ —— 一个可重定位、自带 pip 的独立 CPython 3.12，
// 并已装好 requirements.txt，且随附 app.py + 内置 tools/。该目录会被 Tauri 作为
// bundle.resources 打进 NSIS 安装包，落到安装目录的 python/（与 exe 同级）。
//
// 用法：  node python/build-dist.mjs
//        node python/build-dist.mjs --keep-download   （保留已下载的 tar.gz，便于重跑）
//        node python/build-dist.mjs --sync-only        （只把 app.py+tools/ 同步进
//        已存在的 python-dist，跳过下载/pip；用于改了 Python 源码后、发版前同步）
//
// 为什么不用开发 venv：venv/pyvenv.cfg 硬编码了开发机 base-Python 绝对路径，拷到
// 别的机器即失效。为什么不用 PyInstaller 冻结：会破坏「姬子运行时 pip install 造工具」
// 这一核心功能。python-build-standalone 是可重定位、带真实 pip 的完整 CPython，两难皆解。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { verifyPythonDist } from './verify-dist.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PYTHON_SRC = path.join(PROJECT_ROOT, 'python');
const DIST = path.join(PROJECT_ROOT, 'app', 'src-tauri', 'python-dist');
const RUNTIME = path.join(DIST, 'runtime');
const REQUIREMENTS = path.join(PYTHON_SRC, 'requirements.txt');

const PY_MINOR = '3.12'; // 对齐开发 venv 的 3.12.8，避免 site-packages ABI 不匹配
const RELEASES_API = 'https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest';
const ASSET_RE = new RegExp(
  `^cpython-${PY_MINOR.replace('.', '\\.')}\\.(\\d+)\\+\\d+-x86_64-pc-windows-msvc-install_only\\.tar\\.gz$`,
);

const keepDownload = process.argv.includes('--keep-download');

function log(msg) {
  console.log(`[build-dist] ${msg}`);
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// 选出 latest release 里匹配的 CPython 3.12 install_only 资产，取补丁号最高的一个。
async function resolveAsset() {
  log('查询 python-build-standalone 最新 release…');
  const res = await fetch(RELEASES_API, {
    headers: {
      'User-Agent': 'multi-agent-tool-build-dist',
      Accept: 'application/vnd.github+json',
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API 请求失败: ${res.status} ${res.statusText}`);
  }
  const release = await res.json();
  const candidates = [];
  for (const asset of release.assets ?? []) {
    const m = ASSET_RE.exec(asset.name);
    if (m) candidates.push({ patch: Number(m[1]), name: asset.name, url: asset.browser_download_url });
  }
  if (candidates.length === 0) {
    throw new Error(`release ${release.tag_name} 中未找到 CPython ${PY_MINOR}.x 的 windows install_only 资产`);
  }
  candidates.sort((a, b) => b.patch - a.patch);
  const picked = candidates[0];
  log(`选中 ${picked.name}（release ${release.tag_name}）`);
  return picked;
}

async function download(url, dest) {
  log(`下载 ${url}`);
  const res = await fetch(url, { headers: { 'User-Agent': 'multi-agent-tool-build-dist' } });
  if (!res.ok || !res.body) {
    throw new Error(`下载失败: ${res.status} ${res.statusText}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  const { size } = await fs.stat(dest);
  log(`下载完成，${fmtSize(size)}`);
}

// install_only tar.gz 顶层为 python/，解压后把内部 python/ 内容搬到 runtime/。
async function extractRuntime(tarPath) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pbs-extract-'));
  try {
    log('解压运行时…');
    // Windows 10+ 自带 tar.exe，支持 .tar.gz。
    // --force-local：否则含盘符冒号的路径（C:\…）会被误当成 host:path 远程规格。
    execFileSync('tar', ['--force-local', '-xzf', tarPath, '-C', tmp], { stdio: 'inherit' });
    const inner = path.join(tmp, 'python');
    if (!(await exists(inner))) {
      throw new Error(`解压结构异常：未找到 ${inner}`);
    }
    await fs.rename(inner, RUNTIME).catch(async (e) => {
      // 跨卷 rename 会失败，回退到递归拷贝
      if (e.code === 'EXDEV') {
        await copyDir(inner, RUNTIME, () => true);
      } else {
        throw e;
      }
    });
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

function pipInstall() {
  const py = path.join(RUNTIME, 'python.exe');
  log('pip 安装 requirements.txt（这一步较慢）…');
  execFileSync(py, ['-m', 'pip', 'install', '--no-warn-script-location', '-r', REQUIREMENTS], {
    stdio: 'inherit',
  });
  log('依赖安装完成');
}

// 递归拷贝，filter(relPath, isDir) 返回 false 时跳过该项。
async function copyDir(src, dstBase, filter, rel = '') {
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (!filter(childRel, entry.isDirectory())) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dstBase, childRel);
    if (entry.isDirectory()) {
      await fs.mkdir(to, { recursive: true });
      await copyDir(from, dstBase, filter, childRel);
    } else {
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(from, to);
    }
  }
}

async function copyAppCode() {
  log('拷贝 app 代码（app.py + tools/ + requirements.txt）…');
  await fs.copyFile(path.join(PYTHON_SRC, 'app.py'), path.join(DIST, 'app.py'));
  await fs.copyFile(REQUIREMENTS, path.join(DIST, 'requirements.txt'));

  // 同步时先清理旧源码，避免历史构建目录里残留用户模块或 registry 被误打进安装包。
  await fs.rm(path.join(DIST, 'tools'), { recursive: true, force: true });

  // tools/：排除 __pycache__、tests；custom/ 只保留 __init__.py（空的用户工具目录）
  await copyDir(path.join(PYTHON_SRC, 'tools'), path.join(DIST, 'tools'), (relPath) => {
    const parts = relPath.split('/');
    if (parts.includes('__pycache__')) return false;
    if (parts[0] === 'tests') return false;
    // custom/ 下只放 __init__.py，用户生成的工具与其 registry 不打包
    if (parts[0] === 'custom') {
      return relPath === 'custom' || relPath === 'custom/__init__.py';
    }
    return true;
  });

  log('app 代码拷贝完成');
}

function fmtSize(bytes) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

async function dirSize(dir) {
  let total = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else {
      const { size } = await fs.stat(full);
      total += size;
    }
  }
  return total;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const syncOnly = args.has('--sync-only');

  if (syncOnly) {
    // 只把 app.py + tools/ 同步进已存在的 python-dist(改了 Python 源码后、发版前用)。
    // 不重新下载 CPython、不重跑 pip——runtime/ 和 site-packages/ 保留。
    if (!(await exists(DIST))) {
      throw new Error(`--sync-only 需要 ${DIST} 已存在;先完整跑一次 node python/build-dist.mjs`);
    }
    log(`[sync-only] 同步 app.py + tools/ → ${DIST}`);
    await copyAppCode();
    await verifyPythonDist(DIST);
    log('[sync-only] 完成');
    return;
  }

  if (!(await exists(REQUIREMENTS))) {
    throw new Error(`未找到 ${REQUIREMENTS}`);
  }

  log(`清理旧产物 ${DIST}`);
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(DIST, { recursive: true });

  const asset = await resolveAsset();
  const tarPath = path.join(DIST, asset.name);
  await download(asset.url, tarPath);
  await extractRuntime(tarPath);

  const pyExe = path.join(RUNTIME, 'python.exe');
  if (!(await exists(pyExe))) {
    throw new Error(`解压后未找到解释器 ${pyExe}`);
  }

  pipInstall();
  await copyAppCode();
  await verifyPythonDist(DIST);

  if (!keepDownload) {
    await fs.rm(tarPath, { force: true });
  }

  const size = await dirSize(DIST);
  log('==============================================');
  log(`完成。python-dist 总体积：${fmtSize(size)}`);
  log(`解释器：${pyExe}`);
  log('下一步：cd app && npm run tauri:build');
  log('==============================================');
}

main().catch((e) => {
  console.error(`[build-dist] 失败：${e.message}`);
  process.exit(1);
});

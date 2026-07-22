import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DIST = path.resolve(HERE, '..', 'app', 'src-tauri', 'python-dist');

const REQUIRED_FILES = [
  'runtime/python.exe',
  'app.py',
  'requirements.txt',
  'network_policy.py',
  'safe_http.py',
  'tools/router.py',
  'tools/dynamic.py',
  'tools/installer.py',
  'tools/llm_calling.py',
];

async function assertNonEmptyFile(root, relative) {
  const full = path.join(root, ...relative.split('/'));
  let stat;
  try {
    stat = await fs.stat(full);
  } catch {
    throw new Error(`发布后台不完整，缺少 ${relative}`);
  }
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`发布后台文件无效或为空: ${relative}`);
  }
}

export async function verifyPythonDist(dist = DEFAULT_DIST) {
  for (const relative of REQUIRED_FILES) {
    await assertNonEmptyFile(dist, relative);
  }

  const python = path.join(dist, 'runtime', 'python.exe');
  const tempUserTools = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-collab-dist-check-'));
  const importCheck = [
    'import sys',
    `sys.path.insert(0, ${JSON.stringify(dist)})`,
    'import fastapi, uvicorn, openpyxl, fitz, pdfplumber, chardet, requests, pydantic',
    'import app',
    'from tools import router',
    "print('python-dist-ok')",
  ].join('; ');
  try {
    execFileSync(python, ['-I', '-c', importCheck], {
      cwd: dist,
      env: {
        ...process.env,
        MULTIAGENT_USER_TOOLS_DIR: tempUserTools,
      },
      stdio: 'pipe',
      timeout: 60_000,
    });
  } catch (error) {
    const stderr = error?.stderr?.toString?.().trim();
    throw new Error(
      `发布后台解释器或核心依赖不可用${stderr ? `: ${stderr.slice(-1200)}` : ''}`,
    );
  } finally {
    await fs.rm(tempUserTools, { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  const distArg = process.argv.find((arg) => arg.startsWith('--dist='));
  const dist = distArg ? path.resolve(distArg.slice('--dist='.length)) : DEFAULT_DIST;
  await verifyPythonDist(dist);
  console.log(`[verify-dist] Python 发布后台完整: ${dist}`);
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[verify-dist] 失败: ${error.message}`);
    process.exit(1);
  });
}

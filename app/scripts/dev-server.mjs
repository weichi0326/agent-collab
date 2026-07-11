import http from 'node:http';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const PORT = 5173;
const DEV_URL = `http://${HOST}:${PORT}/`;
const APP_ROOT = fileURLToPath(new URL('..', import.meta.url));
const RUST_TARGET_RE = /[/\\]src-tauri[/\\]target[/\\]/;

process.chdir(APP_ROOT);

function fetchRoot() {
  return new Promise((resolve) => {
    let settled = false;
    const req = http.get(DEV_URL, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        if (body.length < 4096) {
          body += chunk.slice(0, 4096 - body.length);
        }
      });
      res.on('end', () => {
        if (!settled) {
          settled = true;
          resolve(body);
        }
      });
      res.on('error', () => {
        if (!settled) {
          settled = true;
          resolve('');
        }
      });
    });
    req.setTimeout(800, () => {
      req.destroy();
      if (!settled) {
        settled = true;
        resolve('');
      }
    });
    req.on('error', () => {
      if (!settled) {
        settled = true;
        resolve('');
      }
    });
  });
}

function describeStartupError(error) {
  console.error('[dev-server] Failed to start Vite.');
  console.error(`[dev-server] Node ${process.version}; cwd=${process.cwd()}`);
  const message = String(error?.message || error || '');
  if (error?.code === 'ERR_MODULE_NOT_FOUND' || message.includes("Cannot find package 'vite'")) {
    console.error('[dev-server] Frontend dependencies are missing. Run the environment configurator or npm install in app/.');
  }
  if (error?.code === 'EADDRINUSE') {
    console.error(`[dev-server] Port ${PORT} is already in use. Close the process using this port, then start again.`);
    console.error(`[dev-server] Windows check: netstat -ano | findstr :${PORT}`);
  }
  console.error(error?.stack || error?.message || error);
}

function isIgnoredRustTargetBusy(error) {
  const text = String(error?.stack || error?.message || error || '');
  return error?.code === 'EBUSY' && RUST_TARGET_RE.test(text);
}

process.on('uncaughtException', (error) => {
  if (isIgnoredRustTargetBusy(error)) {
    console.warn('[dev-server] Ignored Windows file lock inside src-tauri/target.');
    return;
  }
  describeStartupError(error);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  if (isIgnoredRustTargetBusy(error)) {
    console.warn('[dev-server] Ignored Windows file lock inside src-tauri/target.');
    return;
  }
  describeStartupError(error);
  process.exit(1);
});

try {
  const existing = await fetchRoot();
  if (existing.includes('/src/main.tsx') && existing.includes('多 Agent 协同工具')) {
    console.log(`[dev-server] Reusing existing Vite server at ${DEV_URL}`);
    process.exit(0);
  }

  const { createServer } = await import('vite');
  const server = await createServer({
    clearScreen: false,
    server: {
      host: HOST,
      port: PORT,
      strictPort: true,
      watch: {
        ignored: [RUST_TARGET_RE, '**/src-tauri/target/**', '**/src-tauri/target/**/**'],
      },
    },
  });

  await server.listen();
  server.printUrls();
} catch (error) {
  describeStartupError(error);
  process.exit(1);
}

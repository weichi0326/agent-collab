import http from 'node:http';
import { createServer } from 'vite';

const HOST = '127.0.0.1';
const PORT = 5173;
const DEV_URL = `http://${HOST}:${PORT}/`;

function fetchRoot() {
  return new Promise((resolve) => {
    const req = http.get(DEV_URL, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
        if (body.length > 4096) req.destroy();
      });
      res.on('end', () => resolve(body));
    });
    req.setTimeout(800, () => req.destroy());
    req.on('error', () => resolve(''));
  });
}

const existing = await fetchRoot();
if (existing.includes('/src/main.tsx') || existing.includes('id="root"')) {
  console.log(`[dev-server] Reusing existing Vite server at ${DEV_URL}`);
  process.exit(0);
}

const server = await createServer({
  clearScreen: false,
  server: {
    host: HOST,
    port: PORT,
    strictPort: true,
  },
});

await server.listen();
server.printUrls();

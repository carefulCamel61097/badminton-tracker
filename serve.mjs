/* Static server for local development.
 *
 *   node serve.mjs            http://localhost:8090
 *   node serve.mjs 9000       on another port
 *   BST_PORT=9000 node ...    or from the environment
 *
 * The app has no build step and no dependencies, but it does have to be served
 * over http:// rather than opened as a file:// — ES modules and the CORS
 * request to BWF both refuse to work from a file origin.
 *
 * ⚠️ **Not 8080**, which is the Firebase Firestore emulator's default. On Windows
 * the two do not collide loudly: this server takes the wildcard (0.0.0.0:8080)
 * and the emulator takes loopback (127.0.0.1:8080), *both bind successfully*,
 * and neither says "address already in use". Requests to 127.0.0.1 then reach
 * the emulator while requests to any other host — an Android emulator's
 * 10.0.2.2, say — reach this server and get HTML where they wanted JSON. A
 * silent misrouting bug rather than a startup failure, so it cost an afternoon
 * in another project on this machine (3 September 2026). 8089 is now the
 * emulator's second port; 8090 was free.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2]) || Number(process.env.BST_PORT) || 8090;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
};

export function createServer(root = ROOT) {
  return http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
    const file = path.join(root, rel === '/' ? 'index.html' : rel);

    // Anything resolving outside the served root is a traversal attempt.
    if (!file.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }

    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
        // Editing app.js and hitting reload should show the edit, not a copy
        // the browser cached ninety seconds ago.
        'Cache-Control': 'no-store',
      });
      res.end(buf);
    });
  });
}

// Only listen when run directly, so the suites can import createServer.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer().listen(PORT, () => {
    console.log(`serving ${ROOT}\n  http://localhost:${PORT}/`);
  });
}

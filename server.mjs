#!/usr/bin/env node
// Legacy entrypoint — redirects to src/server.mjs
// Use `node src/server.mjs` or `npm start` instead
console.log('[Crucix] Redirecting to new server entrypoint (src/server.mjs)...');
await import('./src/server.mjs');

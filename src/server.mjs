#!/usr/bin/env node
// Crucix Intelligence Engine — Production Server
// Cloud-native, Railway-ready, non-blocking startup

import express from 'express';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import config from './config/index.mjs';
import { StorageLayer } from './storage/index.mjs';
import { MemoryAdapter } from './storage/memory-adapter.mjs';
import { SweepRunner } from './jobs/sweep.mjs';
import { createRoutes } from './routes/api.mjs';
import { initIntegrations } from './services/integrations.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// === Shared State ===
const state = {
  currentData: null,
  lastSweepTime: null,
  sweepStartedAt: null,
  sweepInProgress: false,
  startTime: Date.now(),
};

const sseClients = new Set();

function broadcast(data) {
  if (!config.enableSSE) return;
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(msg); } catch { sseClients.delete(client); }
  }
}

// === Storage + Memory ===
const storage = new StorageLayer(config.storage.mode);
const memory = new MemoryAdapter(storage);

// === Integrations (Telegram, Discord, LLM) ===
const { llmProvider, telegramAlerter, discordAlerter } = initIntegrations({
  config,
  state,
  memory,
  sseClients,
  runSweep: () => sweepRunner.runSweep(),
});

// === Sweep Runner ===
const sweepRunner = new SweepRunner({
  state,
  config,
  memory,
  storage,
  llmProvider,
  telegramAlerter,
  discordAlerter,
  broadcast,
});

// === Express App ===
const app = express();

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Static files
app.use(express.static(join(ROOT, 'public')));

// API routes
app.use(createRoutes({ state, config, sseClients }));

// Serve dashboard or loading page
app.get('/', (req, res) => {
  if (!state.currentData) {
    res.sendFile(join(ROOT, 'public', 'loading.html'));
  } else {
    res.sendFile(join(ROOT, 'public', 'jarvis.html'));
  }
});

// === Startup ===
async function start() {
  const port = config.port;

  console.log(`
  ╔══════════════════════════════════════════════╗
  ║           CRUCIX INTELLIGENCE ENGINE         ║
  ║          v3.0.0 · Cloud-Native Edition       ║
  ╠══════════════════════════════════════════════╣
  ║  Port:       ${String(port).padEnd(31)}║
  ║  Mode:       ${config.nodeEnv.padEnd(31)}║
  ║  Storage:    ${config.storage.mode.padEnd(31)}║
  ║  Sweeps:     ${(config.enableSweeps ? 'enabled' : 'disabled').padEnd(31)}║
  ║  Refresh:    ${(config.enableSweeps ? `every ${config.refreshIntervalMinutes} min` : 'N/A').padEnd(31)}║
  ║  LLM:        ${(config.llm.provider || 'disabled').padEnd(31)}║
  ║  Telegram:   ${(config.telegramReady ? 'enabled' : 'disabled').padEnd(31)}║
  ║  Discord:    ${(config.discordReady ? 'enabled' : 'disabled').padEnd(31)}║
  ║  SSE:        ${(config.enableSSE ? 'enabled' : 'disabled').padEnd(31)}║
  ╚══════════════════════════════════════════════╝
  `);

  const server = app.listen(port, '0.0.0.0');

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[Crucix] FATAL: Port ${port} is already in use`);
    } else {
      console.error('[Crucix] Server error:', err.message);
    }
    process.exit(1);
  });

  server.on('listening', async () => {
    console.log(`[Crucix] Server listening on port ${port}`);

    // Try to load cached data for instant availability
    await sweepRunner.loadExisting();

    // Start sweep schedule (non-blocking)
    sweepRunner.startSchedule();
  });

  // === Graceful Shutdown ===
  const shutdown = (signal) => {
    console.log(`[Crucix] Received ${signal}, shutting down gracefully...`);

    sweepRunner.stop();

    // Close SSE connections
    for (const client of sseClients) {
      try { client.end(); } catch { /* ignore */ }
    }
    sseClients.clear();

    server.close(() => {
      console.log('[Crucix] Server closed');
      process.exit(0);
    });

    // Force exit after 10s
    setTimeout(() => {
      console.warn('[Crucix] Forcing exit after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Structured error handling
process.on('unhandledRejection', (err) => {
  console.error('[Crucix] Unhandled rejection:', err?.stack || err?.message || err);
});
process.on('uncaughtException', (err) => {
  console.error('[Crucix] Uncaught exception:', err?.stack || err?.message || err);
});

start().catch(err => {
  console.error('[Crucix] FATAL — Server failed to start:', err?.stack || err?.message || err);
  process.exit(1);
});

// API Routes — health, status, data, SSE
import { Router } from 'express';

export function createRoutes({ state, config, sseClients }) {
  const router = Router();

  // Health check — lightweight, always 200 when server is up
  router.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      uptime: Math.floor((Date.now() - state.startTime) / 1000),
      lastSweep: state.lastSweepTime,
      sweepInProgress: state.sweepInProgress,
    });
  });

  // Status — detailed operational status
  router.get('/api/status', (req, res) => {
    res.json({
      status: 'ok',
      version: '3.0.0',
      uptime: Math.floor((Date.now() - state.startTime) / 1000),
      bootTime: new Date(state.startTime).toISOString(),
      lastSweep: state.lastSweepTime,
      nextSweep: state.lastSweepTime
        ? new Date(new Date(state.lastSweepTime).getTime() + config.refreshIntervalMinutes * 60000).toISOString()
        : null,
      sweepInProgress: state.sweepInProgress,
      sweepStartedAt: state.sweepStartedAt,
      hasData: !!state.currentData,
      sourcesOk: state.currentData?.meta?.sourcesOk || 0,
      sourcesFailed: state.currentData?.meta?.sourcesFailed || 0,
      sourcesQueried: state.currentData?.meta?.sourcesQueried || 0,
      integrations: {
        llm: config.llmReady ? config.llm.provider : false,
        telegram: config.telegramReady,
        discord: config.discordReady,
        sweeps: config.enableSweeps,
        sse: config.enableSSE,
      },
      storage: config.storage.mode,
      environment: config.nodeEnv,
    });
  });

  // Data API — returns current synthesized dashboard data
  router.get('/api/data', (req, res) => {
    if (!state.currentData) {
      return res.status(202).json({
        status: 'pending',
        message: 'Intelligence sweep in progress — data not yet available',
        sweepInProgress: state.sweepInProgress,
        sweepStartedAt: state.sweepStartedAt,
      });
    }
    res.json(state.currentData);
  });

  // SSE: live updates
  if (config.enableSSE) {
    router.get('/events', (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
      });
      res.write('data: {"type":"connected"}\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
    });
  }

  return router;
}

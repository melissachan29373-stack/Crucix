// Sweep Job — runs intelligence sweep cycle
// Isolated from server startup so it can be non-blocking

import { fullBriefing } from '../../apis/briefing.mjs';
import { synthesize } from '../../dashboard/inject.mjs';
import { generateLLMIdeas } from '../../lib/llm/ideas.mjs';

export class SweepRunner {
  constructor({ state, config, memory, storage, llmProvider, telegramAlerter, discordAlerter, broadcast }) {
    this.state = state;
    this.config = config;
    this.memory = memory;
    this.storage = storage;
    this.llmProvider = llmProvider;
    this.telegramAlerter = telegramAlerter;
    this.discordAlerter = discordAlerter;
    this.broadcast = broadcast;
    this._intervalId = null;
  }

  async runSweep() {
    if (this.state.sweepInProgress) {
      console.log('[Crucix] Sweep already in progress, skipping');
      return;
    }

    this.state.sweepInProgress = true;
    this.state.sweepStartedAt = new Date().toISOString();
    this.broadcast({ type: 'sweep_start', timestamp: this.state.sweepStartedAt });
    console.log(`[Crucix] Starting sweep at ${new Date().toLocaleTimeString()}`);

    try {
      // 1. Run the full briefing sweep
      const rawData = await fullBriefing();

      // 2. Save to storage
      this.storage.set('latest', rawData);
      this.state.lastSweepTime = new Date().toISOString();

      // 3. Synthesize into dashboard format
      console.log('[Crucix] Synthesizing dashboard data...');
      const synthesized = await synthesize(rawData);

      // 4. Delta computation + memory
      const delta = this.memory.addRun(synthesized);
      synthesized.delta = delta;

      // 5. LLM trade ideas (isolated from sweep)
      if (this.llmProvider?.isConfigured) {
        try {
          console.log('[Crucix] Generating LLM trade ideas...');
          const previousIdeas = this.memory.getLastRun()?.ideas || [];
          const llmIdeas = await generateLLMIdeas(this.llmProvider, synthesized, delta, previousIdeas);
          if (llmIdeas) {
            synthesized.ideas = llmIdeas;
            synthesized.ideasSource = 'llm';
            console.log(`[Crucix] LLM generated ${llmIdeas.length} ideas`);
          } else {
            synthesized.ideas = [];
            synthesized.ideasSource = 'llm-failed';
          }
        } catch (llmErr) {
          console.error('[Crucix] LLM ideas failed (non-fatal):', llmErr.message);
          synthesized.ideas = [];
          synthesized.ideasSource = 'llm-failed';
        }
      } else {
        synthesized.ideas = [];
        synthesized.ideasSource = 'disabled';
      }

      // 6. Alert evaluation
      if (delta?.summary?.totalChanges > 0) {
        if (this.telegramAlerter?.isConfigured) {
          this.telegramAlerter.evaluateAndAlert(this.llmProvider, delta, this.memory).catch(err => {
            console.error('[Crucix] Telegram alert error:', err.message);
          });
        }
        if (this.discordAlerter?.isConfigured) {
          this.discordAlerter.evaluateAndAlert(this.llmProvider, delta, this.memory).catch(err => {
            console.error('[Crucix] Discord alert error:', err.message);
          });
        }
      }

      this.memory.pruneAlertedSignals();
      this.state.currentData = synthesized;

      // 7. Push to connected clients
      this.broadcast({ type: 'update', data: this.state.currentData });

      console.log(`[Crucix] Sweep complete — ${synthesized.meta.sourcesOk}/${synthesized.meta.sourcesQueried} sources OK`);
      if (delta?.summary) {
        console.log(`[Crucix] Delta: ${delta.summary.totalChanges} changes, ${delta.summary.criticalChanges} critical`);
      }
    } catch (err) {
      console.error('[Crucix] Sweep failed:', err.message);
      this.broadcast({ type: 'sweep_error', error: err.message });
    } finally {
      this.state.sweepInProgress = false;
    }
  }

  // Try loading existing data for instant display
  loadExisting() {
    try {
      const existing = this.storage.get('latest');
      if (existing) {
        return synthesize(existing).then(data => {
          this.state.currentData = data;
          console.log('[Crucix] Loaded cached data from previous sweep');
          this.broadcast({ type: 'update', data: this.state.currentData });
          return true;
        });
      }
    } catch { /* no existing data */ }
    return Promise.resolve(false);
  }

  // Start recurring sweeps
  startSchedule() {
    if (!this.config.enableSweeps) {
      console.log('[Crucix] Sweeps disabled (ENABLE_SWEEPS=false)');
      return;
    }

    // Non-blocking first sweep
    console.log('[Crucix] Starting initial sweep (non-blocking)...');
    this.runSweep().catch(err => {
      console.error('[Crucix] Initial sweep failed:', err.message);
    });

    // Schedule recurring
    this._intervalId = setInterval(
      () => this.runSweep().catch(e => console.error('[Crucix] Scheduled sweep failed:', e.message)),
      this.config.refreshIntervalMinutes * 60 * 1000
    );
  }

  stop() {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }
}

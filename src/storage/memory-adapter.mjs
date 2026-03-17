// Memory Manager Adapter — wraps the delta memory system with storage abstraction
// Works in both file-based and memory-only modes

import { computeDelta } from '../../lib/delta/engine.mjs';

const MAX_HOT_RUNS = 3;
const ALERT_DECAY_TIERS = [0, 6, 12, 24]; // hours

export class MemoryAdapter {
  constructor(storage) {
    this.storage = storage;
    this.hot = this._loadHot();
  }

  _loadHot() {
    // Try loading from storage
    const data = this.storage.get('memory/hot');
    if (data && Array.isArray(data.runs) && typeof data.alertedSignals === 'object') {
      return data;
    }

    // Try backup
    const backup = this.storage.get('memory/hot.bak');
    if (backup && Array.isArray(backup.runs) && typeof backup.alertedSignals === 'object') {
      return backup;
    }

    return { runs: [], alertedSignals: {} };
  }

  _saveHot() {
    try {
      // Save backup first
      this.storage.set('memory/hot.bak', { ...this.hot });
      // Then save primary
      this.storage.set('memory/hot', this.hot);
    } catch (err) {
      console.warn('[Memory] Save failed (non-fatal):', err.message);
    }
  }

  addRun(synthesizedData) {
    const previous = this.getLastRun();
    const delta = computeDelta(synthesizedData, previous);

    const compact = this._compactForStorage(synthesizedData);

    this.hot.runs.unshift({
      timestamp: synthesizedData.meta?.timestamp || new Date().toISOString(),
      data: compact,
      delta,
    });

    if (this.hot.runs.length > MAX_HOT_RUNS) {
      this.hot.runs.splice(MAX_HOT_RUNS);
    }

    this._saveHot();
    return delta;
  }

  getLastRun() {
    return this.hot.runs.length > 0 ? this.hot.runs[0].data : null;
  }

  getRunHistory(n = 3) {
    return this.hot.runs.slice(0, n);
  }

  getLastDelta() {
    return this.hot.runs.length > 0 ? this.hot.runs[0].delta : null;
  }

  getAlertedSignals() {
    return this.hot.alertedSignals || {};
  }

  isSignalSuppressed(signalKey) {
    const entry = this.hot.alertedSignals[signalKey];
    if (!entry) return false;

    const now = Date.now();
    const occurrences = typeof entry === 'object' ? (entry.count || 1) : 1;
    const lastAlerted = typeof entry === 'object'
      ? new Date(entry.lastAlerted).getTime()
      : new Date(entry).getTime();

    const tierIndex = Math.min(occurrences, ALERT_DECAY_TIERS.length - 1);
    const cooldownMs = ALERT_DECAY_TIERS[tierIndex] * 3600000;

    return (now - lastAlerted) < cooldownMs;
  }

  markAsAlerted(signalKey, timestamp) {
    const now = timestamp || new Date().toISOString();
    const existing = this.hot.alertedSignals[signalKey];

    if (existing && typeof existing === 'object') {
      existing.count = (existing.count || 1) + 1;
      existing.lastAlerted = now;
      existing.firstSeen = existing.firstSeen || now;
    } else {
      this.hot.alertedSignals[signalKey] = {
        firstSeen: typeof existing === 'string' ? existing : now,
        lastAlerted: now,
        count: typeof existing === 'string' ? 2 : 1,
      };
    }
    this._saveHot();
  }

  pruneAlertedSignals() {
    const now = Date.now();
    for (const [key, entry] of Object.entries(this.hot.alertedSignals)) {
      let lastTime, count;
      if (typeof entry === 'object') {
        lastTime = new Date(entry.lastAlerted).getTime();
        count = entry.count || 1;
      } else {
        lastTime = new Date(entry).getTime();
        count = 1;
      }
      const maxAge = count >= 2 ? 48 * 3600000 : 24 * 3600000;
      if ((now - lastTime) > maxAge) {
        delete this.hot.alertedSignals[key];
      }
    }
    this._saveHot();
  }

  _compactForStorage(data) {
    return {
      meta: data.meta,
      fred: data.fred,
      energy: data.energy,
      bls: data.bls,
      treasury: data.treasury,
      gscpi: data.gscpi,
      tg: data.tg ? {
        posts: data.tg.posts,
        urgent: (data.tg.urgent || []).slice(0, 5),
        topPosts: [],
      } : undefined,
      thermal: (data.thermal || []).map(t => ({
        region: t.region, det: t.det, night: t.night, hc: t.hc,
        fires: [],
      })),
      air: data.air,
      nuke: data.nuke,
      who: (data.who || []).slice(0, 3),
      chokepoints: data.chokepoints,
      sdr: data.sdr ? { total: data.sdr.total, online: data.sdr.online, zones: [] } : undefined,
      acled: data.acled ? {
        totalEvents: data.acled.totalEvents,
        totalFatalities: data.acled.totalFatalities,
      } : undefined,
      markets: data.markets,
    };
  }
}

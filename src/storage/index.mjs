// Storage Abstraction — pluggable persistence for sweep data and memory
// Supports: in-memory (default/cloud), file-based (local dev)
// Never crashes if persistence is unavailable

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

export class StorageLayer {
  constructor(mode = 'memory') {
    this.mode = mode;
    this.cache = new Map();

    if (mode === 'file') {
      this.dataDir = join(ROOT, 'runs');
      this._ensureDir(this.dataDir);
      this._ensureDir(join(this.dataDir, 'memory'));
      this._ensureDir(join(this.dataDir, 'memory', 'cold'));
    }
  }

  _ensureDir(dir) {
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    } catch (err) {
      console.warn(`[Storage] Cannot create directory ${dir}: ${err.message}`);
    }
  }

  get(key) {
    // Always check in-memory cache first
    if (this.cache.has(key)) return this.cache.get(key);

    // Try file fallback
    if (this.mode === 'file') {
      try {
        const filePath = join(this.dataDir, `${key}.json`);
        if (existsSync(filePath)) {
          const data = JSON.parse(readFileSync(filePath, 'utf8'));
          this.cache.set(key, data);
          return data;
        }
      } catch (err) {
        console.warn(`[Storage] Read failed for ${key}: ${err.message}`);
      }
    }

    return null;
  }

  set(key, value) {
    this.cache.set(key, value);

    if (this.mode === 'file') {
      try {
        const filePath = join(this.dataDir, `${key}.json`);
        const tmpPath = filePath + '.tmp';
        writeFileSync(tmpPath, JSON.stringify(value, null, 2));
        renameSync(tmpPath, filePath);
      } catch (err) {
        console.warn(`[Storage] Write failed for ${key}: ${err.message}`);
        // Non-fatal — in-memory cache still has the data
      }
    }
  }

  delete(key) {
    this.cache.delete(key);
    if (this.mode === 'file') {
      try {
        const filePath = join(this.dataDir, `${key}.json`);
        if (existsSync(filePath)) unlinkSync(filePath);
      } catch { /* non-fatal */ }
    }
  }

  // Memory-specific paths for hot/cold storage
  getMemoryPath(filename) {
    if (this.mode !== 'file') return null;
    return join(this.dataDir, 'memory', filename);
  }

  getColdDir() {
    if (this.mode !== 'file') return null;
    return join(this.dataDir, 'memory', 'cold');
  }

  getDataDir() {
    return this.mode === 'file' ? this.dataDir : null;
  }
}

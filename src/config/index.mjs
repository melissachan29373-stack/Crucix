// Crucix Configuration — validated, typed, with safe defaults
// All environment variables are centralized here

import '../../apis/utils/env.mjs'; // Load .env first

function bool(val, fallback = false) {
  if (val === undefined || val === null || val === '') return fallback;
  return val === 'true' || val === '1' || val === 'yes';
}

function int(val, fallback) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : fallback;
}

const config = {
  // === Server ===
  port: int(process.env.PORT, 3117),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: (process.env.NODE_ENV || '').toLowerCase() === 'production',

  // === Feature Flags ===
  enableSweeps: bool(process.env.ENABLE_SWEEPS, true),
  enableSSE: bool(process.env.ENABLE_SSE, true),
  enableTelegram: bool(process.env.ENABLE_TELEGRAM, true),
  enableDiscord: bool(process.env.ENABLE_DISCORD, true),

  // === Sweep ===
  refreshIntervalMinutes: int(process.env.REFRESH_INTERVAL_MINUTES, 15),

  // === LLM ===
  llm: {
    provider: process.env.LLM_PROVIDER || null,
    apiKey: process.env.LLM_API_KEY || null,
    model: process.env.LLM_MODEL || null,
  },

  // === Telegram ===
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || null,
    chatId: process.env.TELEGRAM_CHAT_ID || null,
    botPollingInterval: int(process.env.TELEGRAM_POLL_INTERVAL, 5000),
    channels: process.env.TELEGRAM_CHANNELS || null,
  },

  // === Discord ===
  discord: {
    botToken: process.env.DISCORD_BOT_TOKEN || null,
    channelId: process.env.DISCORD_CHANNEL_ID || null,
    guildId: process.env.DISCORD_GUILD_ID || null,
    webhookUrl: process.env.DISCORD_WEBHOOK_URL || null,
  },

  // === Storage ===
  storage: {
    // 'memory' | 'file' — default to file in dev, memory in production
    mode: process.env.STORAGE_MODE ||
      ((process.env.NODE_ENV || '').toLowerCase() === 'production' ? 'memory' : 'file'),
  },

  // === Delta engine thresholds ===
  delta: {
    thresholds: { numeric: {}, count: {} },
  },
};

// === Derived state: which integrations are actually usable ===
config.telegramReady = !!(config.telegram.botToken && config.telegram.chatId && config.enableTelegram);
config.discordReady = !!(
  (config.discord.botToken || config.discord.webhookUrl) && config.enableDiscord
);
config.llmReady = !!config.llm.provider;

export default config;

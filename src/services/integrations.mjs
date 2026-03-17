// Integration Service — manages Telegram & Discord bots
// Isolated so failures don't affect web server

import { TelegramAlerter } from '../../lib/alerts/telegram.mjs';
import { DiscordAlerter } from '../../lib/alerts/discord.mjs';
import { createLLMProvider } from '../../lib/llm/index.mjs';

export function initIntegrations({ config, state, memory, sseClients, runSweep }) {
  // === LLM ===
  const llmProvider = createLLMProvider(config.llm);
  if (llmProvider) {
    console.log(`[Crucix] LLM enabled: ${llmProvider.name} (${llmProvider.model})`);
  } else {
    console.log('[Crucix] LLM disabled (no provider configured)');
  }

  // === Telegram ===
  let telegramAlerter = null;
  if (config.telegramReady) {
    try {
      telegramAlerter = new TelegramAlerter(config.telegram);
      console.log('[Crucix] Telegram alerts enabled');
      setupTelegramCommands(telegramAlerter, { state, config, llmProvider, sseClients, memory, runSweep });
      telegramAlerter.startPolling(config.telegram.botPollingInterval);
    } catch (err) {
      console.warn('[Crucix] Telegram init failed (non-fatal):', err.message);
      telegramAlerter = null;
    }
  } else {
    console.log('[Crucix] Telegram disabled');
  }

  // === Discord ===
  let discordAlerter = null;
  if (config.discordReady) {
    try {
      discordAlerter = new DiscordAlerter(config.discord);
      console.log('[Crucix] Discord bot enabled');
      setupDiscordCommands(discordAlerter, { state, config, llmProvider, sseClients, memory, runSweep });
      discordAlerter.start().catch(err => {
        console.warn('[Crucix] Discord bot startup failed (non-fatal):', err.message);
      });
    } catch (err) {
      console.warn('[Crucix] Discord init failed (non-fatal):', err.message);
      discordAlerter = null;
    }
  } else {
    console.log('[Crucix] Discord disabled');
  }

  return { llmProvider, telegramAlerter, discordAlerter };
}

function formatUptime(startTime) {
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  const h = Math.floor(uptime / 3600);
  const m = Math.floor((uptime % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatBrief(currentData, memory) {
  if (!currentData) return '⏳ No data yet — waiting for first sweep to complete.';

  const tg = currentData.tg || {};
  const energy = currentData.energy || {};
  const delta = memory.getLastDelta();
  const ideas = (currentData.ideas || []).slice(0, 3);

  const sections = [
    `📋 *CRUCIX BRIEF*`,
    `_${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC_`,
    ``,
  ];

  if (delta?.summary) {
    const dirEmoji = { 'risk-off': '📉', 'risk-on': '📈', 'mixed': '↔️' }[delta.summary.direction] || '↔️';
    sections.push(`${dirEmoji} Direction: *${delta.summary.direction.toUpperCase()}* | ${delta.summary.totalChanges} changes, ${delta.summary.criticalChanges} critical`);
    sections.push('');
  }

  const vix = currentData.fred?.find(f => f.id === 'VIXCLS');
  const hy = currentData.fred?.find(f => f.id === 'BAMLH0A0HYM2');
  if (vix || energy.wti) {
    sections.push(`📊 VIX: ${vix?.value || '--'} | WTI: $${energy.wti || '--'} | Brent: $${energy.brent || '--'}`);
    if (hy) sections.push(`   HY Spread: ${hy.value} | NatGas: $${energy.natgas || '--'}`);
    sections.push('');
  }

  if (tg.urgent?.length > 0) {
    sections.push(`📡 OSINT: ${tg.urgent.length} urgent signals, ${tg.posts || 0} total posts`);
    for (const p of tg.urgent.slice(0, 2)) {
      sections.push(`  • ${(p.text || '').substring(0, 80)}`);
    }
    sections.push('');
  }

  if (ideas.length > 0) {
    sections.push(`💡 *Top Ideas:*`);
    for (const idea of ideas) {
      sections.push(`  ${idea.type === 'long' ? '📈' : idea.type === 'hedge' ? '🛡️' : '👁️'} ${idea.title}`);
    }
  }

  return sections.join('\n');
}

function setupTelegramCommands(alerter, { state, config, llmProvider, sseClients, memory, runSweep }) {
  alerter.onCommand('/status', async () => {
    const llmStatus = llmProvider?.isConfigured ? `✅ ${llmProvider.name}` : '❌ Disabled';
    const nextSweep = state.lastSweepTime
      ? new Date(new Date(state.lastSweepTime).getTime() + config.refreshIntervalMinutes * 60000).toLocaleTimeString()
      : 'pending';

    return [
      `🖥️ *CRUCIX STATUS*`,
      ``,
      `Uptime: ${formatUptime(state.startTime)}`,
      `Last sweep: ${state.lastSweepTime ? new Date(state.lastSweepTime).toLocaleTimeString() + ' UTC' : 'never'}`,
      `Next sweep: ${nextSweep} UTC`,
      `Sweep in progress: ${state.sweepInProgress ? '🔄 Yes' : '⏸️ No'}`,
      `Sources: ${state.currentData?.meta?.sourcesOk || 0}/${state.currentData?.meta?.sourcesQueried || 0} OK`,
      `LLM: ${llmStatus}`,
      `SSE clients: ${sseClients.size}`,
    ].join('\n');
  });

  alerter.onCommand('/sweep', async () => {
    if (state.sweepInProgress) return '🔄 Sweep already in progress. Please wait.';
    runSweep().catch(err => console.error('[Crucix] Manual sweep failed:', err.message));
    return '🚀 Manual sweep triggered.';
  });

  alerter.onCommand('/brief', async () => formatBrief(state.currentData, memory));

  alerter.onCommand('/portfolio', async () =>
    '📊 Portfolio integration requires Alpaca MCP connection.\nUse the Crucix dashboard or Claude agent for portfolio queries.'
  );
}

function setupDiscordCommands(alerter, { state, config, llmProvider, sseClients, memory, runSweep }) {
  alerter.onCommand('status', async () => {
    const llmStatus = llmProvider?.isConfigured ? `✅ ${llmProvider.name}` : '❌ Disabled';
    const nextSweep = state.lastSweepTime
      ? new Date(new Date(state.lastSweepTime).getTime() + config.refreshIntervalMinutes * 60000).toLocaleTimeString()
      : 'pending';

    return [
      `**🖥️ CRUCIX STATUS**\n`,
      `Uptime: ${formatUptime(state.startTime)}`,
      `Last sweep: ${state.lastSweepTime ? new Date(state.lastSweepTime).toLocaleTimeString() + ' UTC' : 'never'}`,
      `Next sweep: ${nextSweep} UTC`,
      `Sweep in progress: ${state.sweepInProgress ? '🔄 Yes' : '⏸️ No'}`,
      `Sources: ${state.currentData?.meta?.sourcesOk || 0}/${state.currentData?.meta?.sourcesQueried || 0} OK`,
      `LLM: ${llmStatus}`,
      `SSE clients: ${sseClients.size}`,
    ].join('\n');
  });

  alerter.onCommand('sweep', async () => {
    if (state.sweepInProgress) return '🔄 Sweep already in progress. Please wait.';
    runSweep().catch(err => console.error('[Crucix] Manual sweep failed:', err.message));
    return '🚀 Manual sweep triggered.';
  });

  alerter.onCommand('brief', async () => {
    // Discord uses **bold** instead of *bold*
    return formatBrief(state.currentData, memory).replace(/\*/g, '**');
  });

  alerter.onCommand('portfolio', async () =>
    '📊 Portfolio integration requires Alpaca MCP connection.'
  );
}

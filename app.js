import dotenv from 'dotenv';
import Decision from './src/Decision/Decision.js';
import PnlController from './src/Controllers/PnlController.js';
import TrailingStopStream from './src/TrailingStop/TrailingStopStream.js';
import CacheController from './src/Controllers/CacheController.js';
import Grid from './src/Grid/Grid.js';
import Achievements from './src/Achievements/Achievements.js';
import Futures from './src/Backpack/Authenticated/Futures.js';

// Load environment variables from ENV_PATH or default to '.env'
const envFile = process.env.ENV_PATH || '.env';

const result = dotenv.config({ path: envFile });
if (result.error) {
  console.error('❌ Error loading env file:', result.error);
}

const Cache = new CacheController();

const TRADING_STRATEGY = process.env.TRADING_STRATEGY;
const PREVIEW_FARM_LAST_HOURS = process.env.PREVIEW_FARM_LAST_HOURS;

// Print clean startup summary with emojis and relevant info
function printStartupSummary({
  week,
  fees,
  volume,
  volumeByFee,
  leverage,
  estimatedPoints,
  strategy,
  last24h,
  lastTradePnL,
  markets
}) {
  console.log("");
  console.log("=========================== Welcome Backbot v2 🤖 ===========================");
  console.log("");
  console.log(`✨ ${week} ✨`);
  console.log("");
  console.log(`💸 Fees: ${fees.toFixed(2)}`);
  console.log(`💰 Volume: ${volume.toFixed(0)}`);
  console.log(`👀 Volume by 1 fee $: ${volumeByFee ? volumeByFee.toFixed(2) : "N/A"}`);
  console.log(`📈 Leverage: ${leverage}`);
  console.log(`🔮 Estimated points: ${estimatedPoints}`);
  console.log(`🎮 Selected strategy: ${strategy}`);
  console.log("");
  console.log(`✨ Last 24 hour(s) ✨`);
  console.log(`💸 Fees: ${last24h.fees.toFixed(2)}`);
  console.log(`💰 Volume: ${last24h.volume.toFixed(0)}`);
  console.log(`👀 Volume by 1 fee $: ${last24h.volumeByFee ? last24h.volumeByFee.toFixed(2) : "N/A"}`);
  console.log(`🔮 Estimated points: ${last24h.estimatedPoints}`);
  console.log("");

  // Only print markets if there are any
  if (markets.length > 0) {
    for (const market of markets) {
      console.log(`📊 Market: ${market.name}`);
      console.log(`🎯 TP: ${market.TP}`);
      console.log(`🚨 SL: ${market.SL}`);
      console.log(`📈 Trend: ${market.trend}`);
      console.log(`💵 Expected PnL: $${market.expectedPnL.toFixed(2)}`);
    }
  }

  // Only print lastTradePnL if non-zero
  if (lastTradePnL && typeof lastTradePnL === "number" && lastTradePnL !== 0) {
    console.log(`💵 Last Trade PnL: ${lastTradePnL >= 0 ? "+" : "-"}$${Math.abs(lastTradePnL).toFixed(2)}`);
  }

  console.log("");
  console.log("==================== Powered by https://x.com/heronjr_x =======================");
  console.log("");
}

async function main() {
  await Cache.update();

  // Wait 5 seconds before starting (to allow cache / env to settle)
  await new Promise((resolve) => setTimeout(resolve, 5000));

  const week = PnlController.getSeasonWeek();

  // Fetch fills for last 7 days
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const fills = await PnlController.getFillHistory(sevenDaysAgo);

  const summary = fills
    ? PnlController.summarizeTrades(fills)
    : { totalFee: 0, totalVolume: 0, volumeBylFee: null };
  const fees = summary.totalFee || 0;
  const volume = summary.totalVolume || 0;
  const volumeByFee = summary.volumeBylFee;

  const leverage = Number(process.env.POSITION_LEVERAGE) || 20;
  const VOLUME_BY_POINT = Number(process.env.VOLUME_BY_POINT) || 1000;
  const estimatedPoints = Math.floor(volume / VOLUME_BY_POINT);

  // Fetch fills & summary for last 24h
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const last24hFills = await PnlController.getFillHistory(oneDayAgo);
  const last24hSummary = last24hFills
    ? PnlController.summarizeTrades(last24hFills)
    : { totalFee: 0, totalVolume: 0, volumeBylFee: null };
  const last24hFees = last24hSummary.totalFee || 0;
  const last24hVolume = last24hSummary.totalVolume || 0;
  const last24hVolumeByFee = last24hSummary.volumeBylFee || null;
  const last24hEstimatedPoints = Math.floor(last24hVolume / VOLUME_BY_POINT);

  // Dynamic last trade PnL instead of static
  let lastTradePnL = 0;
  try {
    const lastTrade = await PnlController.getLastTrade();
    lastTradePnL = lastTrade?.profitLoss ?? 0;
  } catch (e) {
    console.warn("⚠️ Failed to get last trade PnL, using 0:", e);
  }

  // Empty markets to remove any grid/market info (can be populated later if needed)
  const markets = [];

  printStartupSummary({
    week,
    fees,
    volume,
    volumeByFee,
    leverage,
    estimatedPoints,
    strategy: TRADING_STRATEGY,
    last24h: {
      fees: last24hFees,
      volume: last24hVolume,
      volumeByFee: last24hVolumeByFee,
      estimatedPoints: last24hEstimatedPoints,
    },
    lastTradePnL,
    markets,
  });

  if (TRADING_STRATEGY === "DEFAULT") {
    async function startDecision() {
      await Decision.analyze();
      setTimeout(startDecision, 1000 * 60);
    }
    startDecision();

    const enableStopLoss = String(process.env.ENABLE_STOPLOSS).toUpperCase() === "TRUE";
    if (enableStopLoss) {
      TrailingStopStream.start();
    }
  } else if (TRADING_STRATEGY === "AUTOMATIC_STOP") {
    TrailingStopStream.start();
  } else if (TRADING_STRATEGY === "GRID") {
    await Grid.run();
  } else if (TRADING_STRATEGY === "HEDGE_MARKET") {
    console.log("🐋 Don't be hasty, it's coming in the next version. Spoilers in the code.");
  } else if (TRADING_STRATEGY === "ACHIEVEMENTS") {
    console.log("🐋 Don't be hasty, it's coming in the next version. Spoilers in the code.");
  } else {
    console.log(`⚠️ Unknown TRADING_STRATEGY: ${TRADING_STRATEGY}. No action taken.`);
  }
}

main().catch((err) => {
  console.error("Fatal error in app.js:", err);
  process.exit(1);
});

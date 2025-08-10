import Futures from '../Backpack/Authenticated/Futures.js';
import Order from '../Backpack/Authenticated/Order.js';
import OrderController from '../Controllers/OrderController.js';
import AccountController from '../Controllers/AccountController.js';
import Markets from '../Backpack/Public/Markets.js';
import { calculateIndicators } from './Indicators.js';
import CacheController from '../Controllers/CacheController.js';
import Terminal from '../Utils/Terminal.js';

import loadConfig from '../configLoader.js';

const Cache = new CacheController();
const config = loadConfig();

class Decision {
  constructor() {
    // Load config values safely
    this.UNIQUE_TREND = config.UNIQUE_TREND || "";
    this.CERTAINTY = Number(config.CERTAINTY) || 70;
    this.ADAPTIVE_CERTAINTY_ENABLED = Boolean(config.ADAPTIVE_CERTAINTY_ENABLED);
    this.CERTAINTY_ADJUST_STEP = Number(config.CERTAINTY_ADJUST_STEP) || 5;
    this.DEBUG_VERBOSE = Boolean(config.DEBUG_VERBOSE);
    this.PERF_LOGGING_ENABLED = Boolean(config.PERF_LOGGING_ENABLED);

    this.FIXED_ORDER_VOLUME = Number(config.FIXED_ORDER_VOLUME) || 1000;
    this.MAX_ORDER_OPEN = Number(config.MAX_ORDER_OPEN) || 5;
    this.FEE_BUFFER = Number(config.FEE_BUFFER) || 0.0001;

    this.MAX_PERCENT_LOSS = Number(config.MAX_PERCENT_LOSS) || 0.0035;
    this.MAX_PERCENT_PROFIT = Number(config.MAX_PERCENT_PROFIT) || 0.016;

    this.AUTHORIZED_MARKET = Array.isArray(config.AUTHORIZED_MARKET)
      ? config.AUTHORIZED_MARKET
      : (typeof config.AUTHORIZED_MARKET === "string" ? config.AUTHORIZED_MARKET.split(",") : []);

    this.MIN_ATR_PERCENT = Number(config.MIN_ATR_PERCENT) || 0.005;
    this.STOPLOSS_ATR_MULTIPLIER = Number(config.STOPLOSS_ATR_MULTIPLIER) || 0.7;
    this.TAKEPROFIT_ATR_MULTIPLIER = Number(config.TAKEPROFIT_ATR_MULTIPLIER) || 3.0;

    this.ENABLE_STOPLOSS = config.ENABLE_STOPLOSS === "true" || config.ENABLE_STOPLOSS === true;
    this.TRAILING_STOP_ENABLED = config.TRAILING_STOP_ENABLED === "true" || config.TRAILING_STOP_ENABLED === true;
    this.TRAILING_STOP_GAP = Number(config.TRAILING_STOP_GAP) || 0.004;
  }

  async getDataset(account, closedMarkets) {
    try {
      const markets = account.markets.filter(market => {
        const isOpen = !closedMarkets.includes(market.symbol);
        const isAuthorized = this.AUTHORIZED_MARKET.length === 0 || this.AUTHORIZED_MARKET.includes(market.symbol);
        return isOpen && isAuthorized;
      });

      Terminal.init(markets.length, markets.length);
      const dataset = [];

      let count = 0;
      for (const market of markets) {
        try {
          const [candles1m, candles5m, candles15m] = await Promise.all([
            Markets.getKLines(market.symbol, "1m", 30),
            Markets.getKLines(market.symbol, "5m", 30),
            Markets.getKLines(market.symbol, "15m", 30)
          ]);

          const analyze1m = calculateIndicators(candles1m);
          const analyze5m = calculateIndicators(candles5m);
          const analyze15m = calculateIndicators(candles15m);

          const markPrices = await Markets.getAllMarkPrices(market.symbol);
          const marketPrice = markPrices[0]?.markPrice || 0;

          dataset.push({
            market,
            marketPrice,
            "1m": analyze1m,
            "5m": analyze5m,
            "15m": analyze15m
          });

          count++;
          Terminal.update(`📊 Scanning ${markets.length} markets`, count);
        } catch (innerErr) {
          if (this.DEBUG_VERBOSE) console.error(`Error fetching data for ${market.symbol}:`, innerErr);
          continue;
        }
      }

      Terminal.finish();
      return dataset;
    } catch (err) {
      console.error("❌ getDataset Error:", err);
      return [];
    }
  }

  evaluateTradeOpportunity(data) {
    const { market, marketPrice, "1m": tf1, "5m": tf5, "15m": tf15 } = data;
    const mp = parseFloat(marketPrice);

    const scoreSide = (isLong) => {
      let score = 0;
      const total = 9;

      if ((tf15.ema.ema9 > tf15.ema.ema21) === isLong) score++;
      if ((tf5.ema.ema9 > tf5.ema.ema21) === isLong) score++;
      if ((isLong && tf5.rsi.value > 55) || (!isLong && tf5.rsi.value < 45)) score++;
      if ((tf5.macd.MACD > tf5.macd.MACD_signal) === isLong) score++;
      if ((isLong && mp > tf1.bollinger.BOLL_middle) || (!isLong && mp < tf1.bollinger.BOLL_middle)) score++;
      if ((isLong && mp > tf1.vwap.vwap) || (!isLong && mp < tf1.vwap.vwap)) score++;
      if (tf1.volume.volume.trend === "increasing") score++;
      if ((isLong && tf1.volume.price.slope > 0) || (!isLong && tf1.volume.price.slope < 0)) score++;
      if (
        (isLong && tf5.rsi.value > 55 && tf5.macd.MACD > tf5.macd.MACD_signal && tf5.ema.ema9 > tf5.ema.ema21) ||
        (!isLong && tf5.rsi.value < 45 && tf5.macd.MACD < tf5.macd.MACD_signal && tf5.ema.ema9 < tf5.ema.ema21)
      ) score++;

      return Math.round((score / total) * 100);
    };

    const longScore = scoreSide(true);
    const shortScore = scoreSide(false);
    const isLong = longScore > shortScore;
    const certainty = Math.max(longScore, shortScore);

    const entry = isLong
      ? mp - (market.tickSize * 10)
      : mp + (market.tickSize * 10);

    return {
      side: isLong ? "long" : "short",
      certainty,
      ...market,
      entry: parseFloat(entry.toFixed(market.decimal_price)),
    };
  }

  async openOrder(orderData) {
    try {
      if (this.DEBUG_VERBOSE) console.log(`🚀 Attempting to open order for ${orderData.symbol} (${orderData.side})`);

      const orders = await OrderController.getRecentOpenOrders(orderData.symbol);
      const [firstOrder] = orders;

      if (firstOrder && firstOrder.minutes > 3) {
        if (this.DEBUG_VERBOSE) console.log(`🧹 Cancelling old orders for ${orderData.symbol}`);
        await Order.cancelOpenOrders(orderData.symbol);
        await OrderController.openOrder(orderData);
        if (this.DEBUG_VERBOSE) console.log(`✅ Order placed after cancellation for ${orderData.symbol}`);
      } else if (!firstOrder) {
        await OrderController.openOrder(orderData);
        if (this.DEBUG_VERBOSE) console.log(`✅ Order placed for ${orderData.symbol}`);
      } else if (this.DEBUG_VERBOSE) {
        console.log(`⏳ Waiting before placing new order for ${orderData.symbol}`);
      }
    } catch (err) {
      console.error(`❌ openOrder error for ${orderData.symbol}:`, err);
    }
  }

  async analyze() {
    try {
      if (this.DEBUG_VERBOSE) console.log("🔎 Starting analyze cycle...");

      const account = await Cache.get();
      const positions = await Futures.getOpenPositions();
      const openOrders = await Order.getOpenOrders(null, "PERP");

      const openMarkers = [...new Set([
        ...positions.map(p => p.symbol),
        ...openOrders.map(o => o.symbol)
      ])];

      if (this.DEBUG_VERBOSE) {
        console.log(`🔎 Capital available: ${account.capitalAvailable}, Leverage: ${account.leverage}`);
        console.log(`⚖️ Max open orders: ${this.MAX_ORDER_OPEN}, Currently open: ${openMarkers.length}`);
        console.log(`💰 Fixed order volume: ${this.FIXED_ORDER_VOLUME}`);
      }

      const capitalAvailable = Number(account.capitalAvailable);
      const leverage = Number(account.leverage);
      const requiredMargin = (this.FIXED_ORDER_VOLUME / leverage) * (1 + this.FEE_BUFFER);

      if (openMarkers.length >= this.MAX_ORDER_OPEN) {
        if (this.DEBUG_VERBOSE) console.log(`❌ Skipping analyze: Max open orders reached (${openMarkers.length})`);
        return;
      }

      if (requiredMargin >= capitalAvailable) {
        if (this.DEBUG_VERBOSE) console.log(`❌ Skipping analyze: Not enough capital. Required margin: ${requiredMargin.toFixed(4)}, Available: ${capitalAvailable.toFixed(4)}`);
        return;
      }

      const dataset = await this.getDataset(account, positions.map(p => p.symbol));
      if (this.DEBUG_VERBOSE) console.log(`🔎 Dataset size: ${dataset.length}`);

      let certaintyThreshold = this.CERTAINTY;
      if (this.DEBUG_VERBOSE) console.log(`🎯 Initial certainty threshold: ${certaintyThreshold}`);

      // Filter opportunities above threshold
      const opportunities = dataset
        .map(data => this.evaluateTradeOpportunity(data))
        .filter(op => op.certainty >= certaintyThreshold);

      if (this.DEBUG_VERBOSE) console.log(`💡 Opportunities found: ${opportunities.length}`);

      // Adaptive certainty adjustment for next round, if enabled
      if (this.ADAPTIVE_CERTAINTY_ENABLED) {
        certaintyThreshold = Math.max(50, certaintyThreshold - this.CERTAINTY_ADJUST_STEP);
        if (this.DEBUG_VERBOSE) console.log(`🎯 Adjusted certainty threshold: ${certaintyThreshold}`);
      }

      for (const opp of opportunities) {
        const isLong = opp.side === "long";
        const quantity = this.FIXED_ORDER_VOLUME / opp.entry;

        if (quantity <= 0 || !isFinite(quantity)) {
          if (this.DEBUG_VERBOSE) console.log(`⚠️ Invalid quantity (${quantity}) for ${opp.symbol}, skipping.`);
          continue;
        }

        const fee = account.fee || 0.001;
        const feeOpen = this.FIXED_ORDER_VOLUME * fee;
        const feeTotalLoss = (feeOpen + (feeOpen * this.MAX_PERCENT_LOSS)) / quantity;
        const feeTotalProfit = (feeOpen + (feeOpen * this.MAX_PERCENT_PROFIT)) / quantity;

        opp.volume = this.FIXED_ORDER_VOLUME;
        opp.action = opp.side;

        // Set stop loss and take profit based on ATR or fixed percent
        if (this.ENABLE_STOPLOSS && opp["15m"]?.atr) {
          const atr = opp["15m"].atr * opp.entry;
          const minAtrStop = opp.entry * this.MIN_ATR_PERCENT;

          const stopLossDistance = Math.max(atr * this.STOPLOSS_ATR_MULTIPLIER, minAtrStop);

          opp.stop = isLong
            ? opp.entry - stopLossDistance - feeTotalLoss
            : opp.entry + stopLossDistance + feeTotalLoss;

          const takeProfitDistance = atr * this.TAKEPROFIT_ATR_MULTIPLIER;

          opp.target = isLong
            ? opp.entry + takeProfitDistance + feeTotalProfit
            : opp.entry - takeProfitDistance - feeTotalProfit;
        } else {
          opp.stop = isLong
            ? opp.entry - (opp.entry * this.MAX_PERCENT_LOSS) - feeTotalLoss
            : opp.entry + (opp.entry * this.MAX_PERCENT_LOSS) + feeTotalLoss;

          opp.target = isLong
            ? opp.entry + (opp.entry * this.MAX_PERCENT_PROFIT) + feeTotalProfit
            : opp.entry - (opp.entry * this.MAX_PERCENT_PROFIT) - feeTotalProfit;
        }

        opp.stop = parseFloat(opp.stop.toFixed(opp.decimal_price));
        opp.target = parseFloat(opp.target.toFixed(opp.decimal_price));
        opp.entry = parseFloat(opp.entry.toFixed(opp.decimal_price));

        // Calculate expected PNLs
        const expectedProfit = isLong
          ? (opp.target - opp.entry) * quantity
          : (opp.entry - opp.target) * quantity;

        const expectedLoss = isLong
          ? (opp.entry - opp.stop) * quantity
          : (opp.stop - opp.entry) * quantity;

        // Format output exactly as requested
        const formattedSide = isLong ? "LONG 📈" : "SHORT 📉";
        const formattedProfit = expectedProfit >= 0 ? `+$${expectedProfit.toFixed(2)} ✅` : `-$${Math.abs(expectedProfit).toFixed(2)} ❌`;
        const formattedLoss = expectedLoss >= 0 ? `-$${expectedLoss.toFixed(2)} ❌` : `+$${Math.abs(expectedLoss).toFixed(2)} ✅`;

        // Print the formatted output
        console.log(`text🎯 Market: ${opp.symbol} | Side: ${formattedSide}`);
        console.log(`   Entry Price: $${opp.entry.toFixed(opp.decimal_price)}`);
        console.log(`   Quantity: ${quantity.toFixed(4)}`);
        console.log(`   Stop Loss: $${opp.stop.toFixed(opp.decimal_price)}`);
        console.log(`   Take Profit: $${opp.target.toFixed(opp.decimal_price)}`);
        console.log(`   Expected PNL: ${formattedProfit} / ${formattedLoss}`);

        if (this.DEBUG_VERBOSE) {
          console.log(`📈 Placing order for ${opp.symbol}: side=${opp.side}, entry=${opp.entry}, stop=${opp.stop}, target=${opp.target}, volume=${opp.volume.toFixed(2)}`);
        }

        await this.openOrder(opp);
      }
    } catch (err) {
      console.error("❌ analyze() error:", err);
    }
  }
}

export default new Decision();

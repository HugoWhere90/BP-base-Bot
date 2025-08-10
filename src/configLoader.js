import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const parseBoolean = (val) => {
  if (typeof val === "boolean") return val;
  if (typeof val !== "string") return false;
  return val.toLowerCase() === "true";
};

const parseNumber = (val, fallback = 0) => {
  const n = Number(val);
  return isNaN(n) ? fallback : n;
};

const loadConfig = () => {
  return {
    UNIQUE_TREND: (process.env.UNIQUE_TREND || "").toUpperCase().trim(),
    CERTAINTY: parseNumber(process.env.CERTAINTY, 75),
    ADAPTIVE_CERTAINTY_ENABLED: parseBoolean(process.env.ADAPTIVE_CERTAINTY_ENABLED),
    CERTAINTY_ADJUST_STEP: parseNumber(process.env.CERTAINTY_ADJUST_STEP, 2),
    DEBUG_VERBOSE: parseBoolean(process.env.DEBUG_VERBOSE),
    PERF_LOGGING_ENABLED: parseBoolean(process.env.PERF_LOGGING_ENABLED),
    FIXED_ORDER_VOLUME: parseNumber(process.env.FIXED_ORDER_VOLUME, 150),
    MAX_ORDER_OPEN: parseNumber(process.env.MAX_ORDER_OPEN, 3),
    FEE_BUFFER: parseNumber(process.env.FEE_BUFFER, 0.001),
    MAX_PERCENT_LOSS: parseNumber(process.env.MAX_PERCENT_LOSS, 0.005),
    MAX_PERCENT_PROFIT: parseNumber(process.env.MAX_PERCENT_PROFIT, 0.02),
    AUTHORIZED_MARKET: process.env.AUTHORIZED_MARKET ? process.env.AUTHORIZED_MARKET.split(",").map(s => s.trim()) : [],
    MIN_ATR_PERCENT: parseNumber(process.env.MIN_ATR_PERCENT, 0.005),
    STOPLOSS_ATR_MULTIPLIER: parseNumber(process.env.STOPLOSS_ATR_MULTIPLIER, 0.7),
    TAKEPROFIT_ATR_MULTIPLIER: parseNumber(process.env.TAKEPROFIT_ATR_MULTIPLIER, 3.0),
    ENABLE_STOPLOSS: parseBoolean(process.env.ENABLE_STOPLOSS),
    TRAILING_STOP_ENABLED: parseBoolean(process.env.TRAILING_STOP_ENABLED),
    TRAILING_STOP_GAP: parseNumber(process.env.TRAILING_STOP_GAP, 0.004)
  };
};

export default loadConfig;

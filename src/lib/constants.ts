import type { Interval, Pool } from "./types";

export const FIXED = {
  account: 10000,
  runSize: 20,
  peekBars: 300,
  ctxMax: 1500,
  ctxMin: 300,
  futMin: 400,
  yearsBack: 6,
} as const;

export const IV_OK: Interval[] = ["5m", "15m", "1h", "4h", "1d"];

export const IV_CN: Record<Interval, string> = {
  "5m": "5分钟",
  "15m": "15分钟",
  "1h": "1小时",
  "4h": "4小时",
  "1d": "日线",
};

export const IV_MS: Record<string, number> = {
  "1m": 6e4,
  "5m": 3e5,
  "15m": 9e5,
  "30m": 18e5,
  "1h": 36e5,
  "2h": 72e5,
  "4h": 144e5,
  "1d": 864e5,
};

export const POOLS: Record<Pool, { name: string }> = {
  btc: { name: "BTC" },
  btceth: { name: "BTC / ETH" },
  top30: { name: "币安合约成交量前 30" },
  top100: { name: "币安合约成交量前 100" },
};

export const FEE_TAKER = 5 / 10000;
export const FEE_MAKER = 2 / 10000;
export const MMR = 0.005;
export const LEV_MAX = 125;
export const SPEED_MIN = 3;
export const SPEED_MAX = 10;
export const SPEED_OPTS = [3, 4, 5, 6, 8, 10];
export const LEV_CHIPS = [1, 2, 3, 5, 10, 20, 50, 75, 100, 125];

export const FALLBACK_TOP = "BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,DOGEUSDT,BNBUSDT,ADAUSDT,TRXUSDT,AVAXUSDT,LINKUSDT,SUIUSDT,LTCUSDT,BCHUSDT,DOTUSDT,NEARUSDT,UNIUSDT,ATOMUSDT,XLMUSDT,ETCUSDT,FILUSDT,HBARUSDT,APTUSDT,ARBUSDT,OPUSDT,AAVEUSDT,WLDUSDT,ENAUSDT,TONUSDT,ORDIUSDT,INJUSDT".split(",");

export const NOT_COIN = /^(USDC|FDUSD|TUSD|BUSD|USDP|USDE|USD1|BTCDOM|DEFI|FOOTBALL|BLUEBIRD)USDT$/;

/** Candle body colors (green-up base); chart and VOL sub-pane share these. */
export const CANDLE_UP = "#37A74C";
export const CANDLE_DOWN = "#CF4F5F";

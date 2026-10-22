export type SupportedMarket = "US" | "CN" | "HK" | "KR";

const marketLabels: Record<SupportedMarket, string> = {
  US: "US",
  CN: "A Share",
  HK: "Hong Kong",
  KR: "Korea",
};

const marketSuffixes: Array<{ suffix: string; market: SupportedMarket }> = [
  { suffix: ".SS", market: "CN" },
  { suffix: ".SZ", market: "CN" },
  { suffix: ".HK", market: "HK" },
  { suffix: ".KS", market: "KR" },
  { suffix: ".KQ", market: "KR" },
];

export function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase();
}

export function getMarketFromSymbol(symbol: string): SupportedMarket {
  const normalized = normalizeSymbol(symbol);
  const matched = marketSuffixes.find(({ suffix }) => normalized.endsWith(suffix));

  return matched?.market ?? "US";
}

export function getMarketLabel(market: SupportedMarket) {
  return marketLabels[market];
}

export function getMarketLabelFromSymbol(symbol: string) {
  return getMarketLabel(getMarketFromSymbol(symbol));
}

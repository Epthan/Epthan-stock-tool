import YahooFinance from "yahoo-finance2";
import type { TimeframeKey } from "@/lib/mock-market";

const yahooFinance = new YahooFinance();

export async function getYahooQuotes(symbols: string[]) {
  return yahooFinance.quote(symbols, { return: "array" });
}

export async function getYahooQuote(symbol: string) {
  return yahooFinance.quote(symbol);
}

export async function getYahooQuoteSummary(symbol: string) {
  return yahooFinance.quoteSummary(symbol, {
    modules: ["price", "summaryDetail", "financialData", "defaultKeyStatistics", "assetProfile"],
  });
}

export async function getYahooHistorical(symbol: string, period1: string, period2: string) {
  return yahooFinance.historical(symbol, {
    period1,
    period2,
    interval: "1d",
  });
}

export async function searchYahooSymbols(query: string) {
  return yahooFinance.search(query, {
    quotesCount: 16,
    newsCount: 0,
    enableFuzzyQuery: true,
  });
}

function getStartDate(now: Date, timeframe: TimeframeKey) {
  const start = new Date(now);

  switch (timeframe) {
    case "1D":
      start.setDate(start.getDate() - 1);
      break;
    case "2D":
      start.setDate(start.getDate() - 2);
      break;
    case "5D":
      start.setDate(start.getDate() - 5);
      break;
    case "1W":
      start.setDate(start.getDate() - 7);
      break;
    case "1M":
      start.setMonth(start.getMonth() - 1);
      break;
    case "3M":
      start.setMonth(start.getMonth() - 3);
      break;
    case "6M":
      start.setMonth(start.getMonth() - 6);
      break;
    case "1Y":
      start.setFullYear(start.getFullYear() - 1);
      break;
    case "5Y":
      start.setFullYear(start.getFullYear() - 5);
      break;
    case "10Y":
      start.setFullYear(start.getFullYear() - 10);
      break;
    case "MAX":
      start.setFullYear(start.getFullYear() - 50);
      break;
  }

  return start;
}

function getChartInterval(timeframe: TimeframeKey) {
  switch (timeframe) {
    case "1D":
    case "2D":
      return "5m" as const;
    case "5D":
      return "15m" as const;
    case "1W":
      return "30m" as const;
    case "1M":
    case "3M":
    case "6M":
      return "1d" as const;
    case "1Y":
      return "1wk" as const;
    case "5Y":
      return "1wk" as const;
    case "10Y":
    case "MAX":
      return "1mo" as const;
  }
}

export async function getYahooChart(symbol: string, timeframe: TimeframeKey) {
  const period2 = new Date();
  const period1 = getStartDate(period2, timeframe);
  const interval = getChartInterval(timeframe);

  return yahooFinance.chart(symbol, {
    period1,
    period2,
    interval,
    includePrePost: false,
  });
}

export async function getYahooSparklines(symbols: string[], timeframe: TimeframeKey) {
  const responses = await Promise.all(
    symbols.map(async (symbol) => {
      const chart = await getYahooChart(symbol, timeframe);
      return [symbol, chart] as const;
    }),
  );

  return new Map(responses);
}

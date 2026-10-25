// Public build-time settings. Only NEXT_PUBLIC_* variables reach the browser.
const provider = process.env.NEXT_PUBLIC_DATA_PROVIDER ?? "mock";
const defaultSymbol = process.env.NEXT_PUBLIC_DEFAULT_SYMBOL ?? "AAPL";

export const env = {
  provider,
  defaultSymbol,
};

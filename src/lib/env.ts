const provider = process.env.NEXT_PUBLIC_DATA_PROVIDER ?? "mock";
const defaultSymbol = process.env.NEXT_PUBLIC_DEFAULT_SYMBOL ?? "AAPL";

export const env = {
  provider,
  defaultSymbol,
};

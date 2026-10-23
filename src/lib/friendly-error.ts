/** Turn raw API / network errors into a short explanation plus what to do. */
export type ErrorKind = "rate" | "network" | "price" | "input" | "other";

export function classifyError(message: string | undefined): ErrorKind {
  const text = message ?? "";
  if (/429|too many|rate.?limit|crumb|unauthori[sz]ed/i.test(text)) return "rate";
  if (/failed to fetch|network|timeout|timed out|ECONN|EAI_AGAIN|ENOTFOUND|HTTP 5\d\d|502|503|504|unavailable/i.test(text)) return "network";
  if (/no daily price|completed daily price|historical prices incomplete|no historical|no fx rates/i.test(text)) return "price";
  if (/invalid|record at least|choose|enter|require|supports up to|insufficient/i.test(text)) return "input";
  return "other";
}

export function friendlyError(message: string | undefined, zh: boolean) {
  const kind = classifyError(message);
  const copy: Record<ErrorKind, [string, string, string, string]> = {
    rate: ["Yahoo is rate-limiting requests", "Yahoo 暂时限制了请求频率", "This usually clears within a minute. The page retries automatically.", "通常一分钟内恢复，页面会自动重试。"],
    network: ["Can't reach market data", "暂时连不上行情数据", "Check the internet connection on the computer running the app; the page retries automatically.", "请检查运行本工具的电脑网络是否正常，页面会自动重试。"],
    price: ["Price data not complete yet", "行情数据还不完整", "Usually a trade dated today or on a holiday. Check the trade date, or try again after the market closes.", "通常是交易日期为今天或节假日。请核对交易日期，或收盘后再试。"],
    input: ["Check the inputs", "请检查输入", "", ""],
    other: ["Something went wrong", "出了点问题", "Try again; if it keeps happening, restart the app with start-localhost.bat.", "请重试；如果反复出现，用 start-localhost.bat 重启本工具。"],
  };
  const [titleEn, titleZh, hintEn, hintZh] = copy[kind];
  return { kind, title: zh ? titleZh : titleEn, hint: zh ? hintZh : hintEn, detail: message ?? "", transient: kind === "rate" || kind === "network" };
}

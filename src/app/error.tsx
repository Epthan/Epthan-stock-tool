"use client";

import Link from "next/link";
import { useEffect } from "react";

/** Last-resort boundary: a crashed page shows a way back instead of a blank screen. Data is stored separately and is not affected. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  let zh = true;
  try { zh = (window.localStorage.getItem("stock-tool.locale.v1") ?? "zh").includes("zh"); } catch {}
  return <main className="ui-crash">
    <section className="ui-state ui-state-error" role="alert">
      <span className="ui-state-icon" aria-hidden>!</span>
      <div>
        <h2>{zh ? "这个页面出错了" : "This page hit an error"}</h2>
        <div className="ui-state-body"><p>{zh ? "你的组合、交易和自选数据不受影响。可以重新加载本页，或回到行情页。" : "Your portfolios, trades and watch lists are not affected. Reload this page or go back to Market."}</p><p className="ui-state-detail">{error.message}</p></div>
        <div className="ui-state-actions"><button className="ui-state-button" onClick={reset}>{zh ? "重新加载" : "Reload"}</button><Link className="ui-state-button" href="/">{zh ? "回到行情" : "Back to Market"}</Link></div>
      </div>
    </section>
  </main>;
}

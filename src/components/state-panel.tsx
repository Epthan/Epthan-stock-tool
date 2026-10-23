"use client";

import { useEffect, useState, type ReactNode } from "react";
import { friendlyError } from "@/lib/friendly-error";

/** One look for loading, empty and error states across the app. */
export function StatePanel({ kind, title, children, action, compact }: { kind: "loading" | "empty" | "error"; title: string; children?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return <section className={`ui-state ui-state-${kind}${compact ? " is-compact" : ""}`} role={kind === "error" ? "alert" : "status"}>
    <span className="ui-state-icon" aria-hidden>{kind === "loading" ? <i className="ui-spinner" /> : kind === "error" ? "!" : "○"}</span>
    <div><h2>{title}</h2>{children && <div className="ui-state-body">{children}</div>}{action && <div className="ui-state-actions">{action}</div>}</div>
  </section>;
}

/** Error state with a friendly explanation; transient errors retry by themselves after a countdown. */
export function ErrorState({ message, zh, onRetry, compact, autoRetrySeconds = 20 }: { message: string; zh: boolean; onRetry?: () => void; compact?: boolean; autoRetrySeconds?: number }) {
  const info = friendlyError(message, zh);
  const auto = info.transient && !!onRetry;
  const [left, setLeft] = useState(autoRetrySeconds);
  useEffect(() => {
    if (!auto) return;
    const timer = window.setInterval(() => setLeft((value) => value - 1), 1000);
    return () => window.clearInterval(timer);
  }, [auto]);
  useEffect(() => { if (auto && left <= 0) onRetry?.(); }, [auto, left, onRetry]);
  return <StatePanel kind="error" compact={compact} title={info.title} action={onRetry && <button className="ui-state-button" onClick={onRetry}>{zh ? "重试" : "Retry"}{auto && left > 0 ? ` · ${left}s` : ""}</button>}>
    {info.hint && <p>{info.hint}</p>}
    {info.detail && info.kind !== "rate" && <p className="ui-state-detail">{info.detail}</p>}
  </StatePanel>;
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useLanguage } from "@/components/language-provider";
import { useStockSelection } from "@/components/stock-selection-provider";
import { SymbolSearchBox } from "@/components/symbol-search-box";
import { DataSync } from "@/components/data-sync";
import { CorporateActionSync } from "@/components/corporate-action-sync";
import { useTheme, type ThemeChoice } from "@/components/theme-provider";

const icons = {
  market: <path d="M3 17l5-6 4 3 6-8 3 4M3 21h18" />,
  portfolio: <><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5V12l6 6" /></>,
  trades: <><path d="M5 4h14v16H5z" /><path d="M8.5 9h7M8.5 13h7M8.5 17h4" /></>,
  compare: <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />,
  heatmap: <path d="M3.5 3.5h9v9h-9zM12.5 3.5h8v5h-8zM12.5 8.5h8v12h-8zM3.5 12.5h9v8h-9z" />,
  tax: <><path d="M6 3h9l3 3v15H6z" /><path d="M9 16l6-6M9.5 10.5h.01M14.5 15.5h.01" /></>,
};

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { locale, toggleLocale, messages } = useLanguage();
  const { pickSymbol } = useStockSelection();
  const { choice, setChoice } = useTheme();
  const zh = locale === "zh";
  const items = [
    { href: "/", label: zh ? "行情" : "Market", icon: icons.market, active: pathname === "/" },
    { href: "/dashboard", label: zh ? "组合" : "Portfolio", icon: icons.portfolio, active: pathname === "/dashboard" },
    { href: "/portfolio", label: zh ? "交易" : "Trades", icon: icons.trades, active: pathname === "/portfolio" },
    { href: "/tax", label: zh ? "税务" : "Tax", icon: icons.tax, active: pathname === "/tax" },
    { href: "/compare", label: zh ? "对比" : "Compare", icon: icons.compare, active: pathname === "/compare" },
    { href: "/treemap", label: zh ? "热力图" : "Heatmap", icon: icons.heatmap, active: pathname.startsWith("/treemap") },
  ];
  const titles: Record<string, string> = zh
    ? { "/": "行情", "/dashboard": "投资组合", "/portfolio": "交易记录", "/compare": "多股对比" }
    : { "/": "Market", "/dashboard": "Portfolio", "/portfolio": "Trade log", "/compare": "Compare" };
  const title = titles[pathname] ?? (pathname.startsWith("/treemap") ? (zh ? "市场热力图" : "Heatmap") : "");
  const skins: { value: ThemeChoice; label: string }[] = [
    { value: "auto", label: zh ? "自动" : "Auto" },
    { value: "gray", label: zh ? "灰白" : "Light" },
    { value: "gold", label: zh ? "黑金" : "Gold" },
    { value: "night", label: zh ? "夜间" : "Night" },
  ];

  return (
    <div className="shell">
      <DataSync />
      <CorporateActionSync />
      <nav className="shell-rail" aria-label={zh ? "主导航" : "Main navigation"}>
        <Link href="/" className="shell-logo" aria-label="Stock Tool">S</Link>
        {items.map((item) => (
          <Link key={item.href} href={item.href} className="shell-item" aria-current={item.active ? "page" : undefined}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{item.icon}</svg>
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="shell-main">
        <header className="shell-top">
          {title && <h1 className="shell-title">{title}</h1>}
          <div className="shell-spacer" />
          <div className="shell-search"><SymbolSearchBox onPick={pickSymbol} placeholder={zh ? "搜索股票代码或公司" : "Search symbol or company"} /></div>
          <div className="shell-controls">
            <div className="shell-seg" role="group" aria-label={zh ? "主题" : "Theme"}>
              {skins.map((skin) => <button key={skin.value} type="button" aria-pressed={choice === skin.value} onClick={() => setChoice(skin.value)}>{skin.label}</button>)}
            </div>
            <button type="button" className="shell-btn" onClick={toggleLocale} aria-label={messages.nav.toggleLanguage} title={messages.nav.toggleLanguage}>{zh ? "中" : "EN"}</button>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}

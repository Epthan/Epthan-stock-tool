"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { useStockSelection } from "@/components/stock-selection-provider";
import { SymbolSearchBox } from "@/components/symbol-search-box";
import { useTheme } from "@/components/theme-provider";

export function AppNav() {
  const pathname = usePathname();
  const { locale, messages, toggleLocale } = useLanguage();
  const { pickSymbol } = useStockSelection();
  const { choice, resolvedTheme, setChoice } = useTheme();
  const navigationRef = useRef<HTMLElement>(null);
  const measurementRef = useRef<HTMLDivElement>(null);
  const overflowRef = useRef<HTMLDetailsElement>(null);
  const [visibleCount, setVisibleCount] = useState(5);
  useEffect(() => {
    function measure() {
      if (!navigationRef.current || !measurementRef.current) return;
      const widths = Array.from(measurementRef.current.children).map((item) => item.getBoundingClientRect().width);
      const available = navigationRef.current.clientWidth;
      const total = widths.reduce((sum, width) => sum + width, 0) + (widths.length - 1) * 4;
      let count = widths.length;
      if (total > available) {
        let used = 40;
        count = 0;
        for (const width of widths) {
          if (used + width + 4 > available) break;
          used += width + 4;
          count += 1;
        }
      }
      setVisibleCount(count);
    }
    const observer = new ResizeObserver(measure);
    if (navigationRef.current) observer.observe(navigationRef.current);
    if (measurementRef.current) observer.observe(measurementRef.current);
    measure();
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !overflowRef.current?.contains(event.target)) overflowRef.current?.removeAttribute("open");
    }
    function closeEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && overflowRef.current?.open) {
        overflowRef.current.removeAttribute("open");
        overflowRef.current.querySelector("summary")?.focus();
      }
    }
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, [locale]);
  const themeOptions = [
    { value: "auto" as const, label: locale === "zh" ? "自动" : "Auto" },
    { value: "day" as const, label: locale === "zh" ? "白天" : "Day" },
    { value: "night" as const, label: locale === "zh" ? "夜晚" : "Night" },
  ];
  const navItems = [
    { href: "/dashboard", label: locale === "zh" ? "投资组合" : "Dashboard" },
    { href: "/", label: "Workplace" },
  ];

  return (
    <header className="app-navbar sticky top-0 z-50 border-b border-white/8 bg-slate-950/80 backdrop-blur">
      <div className="app-navbar-inner">
        <div className="app-navbar-brand">
          <p className="text-xs uppercase tracking-[0.28em] text-teal-300">{messages.nav.title}</p>
          <p className="text-sm text-slate-400">{messages.nav.subtitle}</p>
        </div>

        <nav ref={navigationRef} className="app-navbar-links" aria-label={locale === "zh" ? "主导航" : "Main navigation"}>
          <div ref={measurementRef} className="app-nav-measure" aria-hidden="true">{navItems.map((item) => <span key={item.href}>{item.label}</span>)}</div>
          {navItems.slice(0, visibleCount).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={(item.href === "/dashboard" ? pathname === "/dashboard" || pathname === "/portfolio" : pathname === "/" || pathname === "/compare" || pathname.startsWith("/treemap")) ? "page" : undefined}
              className="text-sm text-slate-200 transition"
            >
              {item.label}
            </Link>
          ))}
          {visibleCount < navItems.length && <details ref={overflowRef} className="app-nav-overflow">
            <summary aria-label={locale === "zh" ? "更多导航" : "More navigation"} title={locale === "zh" ? "更多导航" : "More navigation"}>···</summary>
            <div className="app-nav-dropdown">{navItems.slice(visibleCount).map((item) => <Link key={item.href} href={item.href} onClick={() => overflowRef.current?.removeAttribute("open")}>{item.label}</Link>)}</div>
          </details>}
        </nav>

        <div className="app-navbar-search relative z-40 w-full">
          <SymbolSearchBox onPick={pickSymbol} />
        </div>

        <div className="app-navbar-controls flex items-center gap-2">
          <div
            className="inline-flex rounded-full border border-white/10 bg-white/5 p-1"
            aria-label={locale === "zh" ? "主题模式" : "Theme mode"}
            title={
              locale === "zh"
                ? `当前主题：${resolvedTheme === "day" ? "白天" : "夜晚"}`
                : `Current theme: ${resolvedTheme}`
            }
          >
            {themeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setChoice(option.value)}
                className={`rounded-full px-3 py-1.5 text-xs transition ${
                  choice === option.value
                    ? "bg-teal-300 text-slate-950"
                    : "text-slate-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={toggleLocale}
            aria-label={messages.nav.toggleLanguage}
            title={messages.nav.toggleLanguage}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 transition hover:border-teal-300/30 hover:bg-white/10"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4">
              <path
                d="M8 1.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 0 0 0-13Zm0 0c1.4 1.4 2.2 3.3 2.2 5.2S9.4 10.5 8 12c-1.4-1.5-2.2-3.4-2.2-5.3S6.6 2.9 8 1.5Zm-5 6.1h10m-9 3.1h8"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.2"
              />
            </svg>
            <span>{locale === "en" ? "EN" : "中文"}</span>
          </button>
        </div>
      </div>
    </header>
  );
}

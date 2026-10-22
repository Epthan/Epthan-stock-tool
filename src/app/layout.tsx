import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { AppNav } from "@/components/app-nav";
import { LanguageProvider } from "@/components/language-provider";
import { StockSelectionProvider } from "@/components/stock-selection-provider";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";
import "./portfolio-dashboard.css";
import "./portfolio-manager.css";
import "./product-refinement.css";
import "./backtest.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Stock Market Workplace",
  description: "A web-based US stock dashboard focused on quotes, charts, watchlists, and market overview.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-[#020617]">
        <LanguageProvider>
          <ThemeProvider>
            <StockSelectionProvider>
              <AppNav />
              {children}
            </StockSelectionProvider>
          </ThemeProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}

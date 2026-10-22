import type { Metadata } from "next";
import type { ReactNode } from "react";
import { IBM_Plex_Sans, Noto_Sans_SC } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { LanguageProvider } from "@/components/language-provider";
import { StockSelectionProvider } from "@/components/stock-selection-provider";
import { ThemeProvider, themeBootScript } from "@/components/theme-provider";
import "./globals.css";
import "./portfolio-dashboard.css";
import "./portfolio-manager.css";
import "./product-refinement.css";
import "./backtest.css";
import "./trade-ledger.css";
import "./trader-analytics.css";
import "./theme.css";
import "./redesign.css";

// Both fonts are SIL Open Font License: free for commercial use and web embedding.
const plex = IBM_Plex_Sans({
  variable: "--font-plex",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
});

const notoSansSC = Noto_Sans_SC({
  variable: "--font-noto-sc",
  weight: ["400", "500", "700"],
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "Stock Tool",
  description: "Personal market workspace and portfolio analytics.",
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
      className={`${plex.variable} ${notoSansSC.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-full">
        <LanguageProvider>
          <ThemeProvider>
            <StockSelectionProvider>
              <AppShell>{children}</AppShell>
            </StockSelectionProvider>
          </ThemeProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}

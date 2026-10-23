import type { Metadata } from "next";
import type { ReactNode } from "react";
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
import "./pages.css";

// IBM Plex Sans + Noto Sans SC: both SIL Open Font License (free for commercial use and web embedding).
// Loaded as a stylesheet so they work without build-time font fetching.
const fontsHref = "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600&family=Noto+Sans+SC:wght@400;500;700&display=swap";

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
      className="h-full antialiased"
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={fontsHref} />
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

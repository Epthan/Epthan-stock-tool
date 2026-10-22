import { StockDashboard } from "@/components/stock-dashboard";
import { env } from "@/lib/env";

export default function Home() {
  return <StockDashboard defaultSymbol={env.defaultSymbol} />;
}

import { TreemapView } from "@/components/treemap-view";

type TreemapPageProps = {
  params: Promise<{
    index: "sp100" | "sp500" | "nasdaq100";
  }>;
};

export default async function TreemapPage({ params }: TreemapPageProps) {
  const { index } = await params;
  const resolvedIndex = index === "nasdaq100" ? "nasdaq100" : "sp100";

  return <TreemapView initialIndex={resolvedIndex} />;
}

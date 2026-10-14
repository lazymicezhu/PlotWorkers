import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "小人画风对比 · Plot Workers",
  description: "在独立预览中对比原版小人与包工头同画风的新形象。",
};

export default function WorkerStylePreviewLayout({ children }: { children: ReactNode }) {
  return children;
}

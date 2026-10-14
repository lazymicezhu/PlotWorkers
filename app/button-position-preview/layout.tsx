import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "按钮位置预览 · Plot Workers",
  description: "拖动调整地块上配方与合成按钮的位置。",
};

export default function ButtonPositionLayout({ children }: { children: ReactNode }) {
  return children;
}

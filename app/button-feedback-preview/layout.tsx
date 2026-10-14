import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "按钮动效预览 · Plot Workers",
  description: "独立体验工坊按钮的轻压、回弹与点击反馈。",
};

export default function ButtonFeedbackLayout({ children }: { children: ReactNode }) {
  return children;
}

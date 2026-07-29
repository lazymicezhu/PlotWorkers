import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "白境 · 小人调度实验场",
  description: "拖动白色小人，把他们安排到不同的 2.5D 地块中工作。",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

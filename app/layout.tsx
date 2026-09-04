import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Plot Workers · 增量工坊经营",
  description: "在 2.5D 地块间调度人物，完成采集、加工、出售与生活恢复循环。",
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

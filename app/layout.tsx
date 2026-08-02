import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "绿野地块",
  description: "可以自由行走的 2.5D 立体地块场景。",
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

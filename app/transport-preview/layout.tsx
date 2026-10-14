import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "机器人搬运预览 · Plot Workers",
  description: "按距离搬运、线性加减速，以及移动地块后的实时改道。",
};

export default function TransportPreviewLayout({ children }: { children: ReactNode }) {
  return children;
}

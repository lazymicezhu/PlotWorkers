const drawings: Record<string, string> = {
  factory: '<path d="M3 20V10l6 3V8l6 3V4h4l2 16H3Z"/><path d="M7 16h1m4 0h1m4 0h1"/>',
  shop: '<path d="M3 9l2-5h14l2 5v3a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0V9Z"/><path d="M5 15v6h14v-6M3 9h18M10 21v-5h4v5"/>',
  research: '<path d="M9 3h6M10 3v6L4 19a1.3 1.3 0 0 0 1.1 2h13.8a1.3 1.3 0 0 0 1.1-2L14 9V3M7 14h10"/><path d="M10 17h.01M14 18h.01"/>',
  orders: '<rect x="5" y="4" width="14" height="17" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 11h6M9 15h4"/>',
  refresh: '<path d="M4 12a8 8 0 0 1 13.66-5.66L20 8.68M20 4.5v4.18h-4.18M20 12a8 8 0 0 1-13.66 5.66L4 15.32M4 19.5v-4.18h4.18"/>',
  "refresh-ticket": '<path d="M3 5h18v5a2 2 0 0 0 0 4v5H3v-5a2 2 0 0 0 0-4V5Z"/><path d="M15 10a3.5 3.5 0 1 0 .4 3M15 7v3h-3"/>',
  "golden-ticket": '<path d="M3 5h18v5a2 2 0 0 0 0 4v5H3v-5a2 2 0 0 0 0-4V5Z"/><path d="m12 8 1.2 2.5 2.8.4-2 1.9.5 2.7-2.5-1.3-2.5 1.3.5-2.7-2-1.9 2.8-.4L12 8Z"/>',
  box: '<path d="m3 7 9-4 9 4v10l-9 4-9-4V7Zm0 0 9 4 9-4M12 11v10M7.5 5l9 4"/>',
  bag: '<path d="M6 8h12l2 12H4L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2M9 13h6"/>',
  worker: '<circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2M8 8h8M12 3v3"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2"/>',
  robot: '<rect x="4" y="7" width="16" height="13" rx="4"/><path d="M12 3v4M9 16h6M8 11v1m8-1v1M1 12v4m22-4v4"/><circle cx="12" cy="3" r="1"/>',
  plots: '<path d="m12 3 10 6-10 6L2 9l10-6Zm-10 12 10 6 10-6M2 12l10 6 10-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M12 6v12m3-9h-4a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H9"/>',
  can: '<ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v14c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 16c0 1.7 3.1 3 7 3s7-1.3 7-3M9 11h6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  leaf: '<path d="M20 3c0 12-4 17-10 17a7 7 0 0 1 0-14c4 0 7-1 10-3ZM4 21 16 9"/>',
};
export function TabletIcon({ name, size = 20 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: drawings[name] ?? drawings.box }} />;
}

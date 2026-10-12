export type GameAutosaveReason = "interval" | "leave";
type AutosaveWindow = Pick<Window, "setInterval" | "clearInterval" | "addEventListener" | "removeEventListener">;
type AutosaveDocument = Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;

/** Read the current committed game in save; never capture a startup snapshot here. */
export function startGameAutosave(
  save: (reason: GameAutosaveReason) => void,
  pageWindow: AutosaveWindow = window,
  pageDocument: AutosaveDocument = document,
) {
  let active = true;
  const timer = pageWindow.setInterval(() => {
    if (active) save("interval");
  }, 30_000);

  const onPageHide = () => {
    if (active) save("leave");
  };
  const onVisibilityChange = () => {
    if (pageDocument.visibilityState === "hidden") onPageHide();
  };
  pageWindow.addEventListener("pagehide", onPageHide);
  pageDocument.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    if (!active) return;
    active = false;
    pageWindow.clearInterval(timer);
    pageWindow.removeEventListener("pagehide", onPageHide);
    pageDocument.removeEventListener("visibilitychange", onVisibilityChange);
    // React cleanup/remount is not a page exit and must not write an old game.
  };
}

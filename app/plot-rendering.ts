import type { PlotState } from "./game-engine.ts";

// Original shadows/sides are below every plot top. A baked image puts all of
// them at the top's z-index; retain the old layers when their lower-half bounds
// overlap an earlier plot, whose top would otherwise be painted underneath.
export function layeredBackingPlots(plots: readonly PlotState[]) {
  // Imported saves may contain rectangular plots; only square assets exist.
  const layered = new Set(plots.filter((plot) => plot.cols !== plot.rows || ![4, 8].includes(plot.cols)).map((plot) => plot.id));
  for (let i = 0; i < plots.length; i++) {
    const plot = plots[i];
    const bottom = (plot.rows * 54 + 38) * 1.08;
    for (let j = 0; j < i; j++) {
      const other = plots[j];
      const lowerHalvesOverlap = plot.x < other.x + other.cols * 104 && plot.x + plot.cols * 104 > other.x &&
        plot.y + plot.rows * 27 < other.y + (other.rows * 54 + 38) * 1.08 &&
        plot.y + bottom > other.y + other.rows * 27;
      if (lowerHalvesOverlap) {
        layered.add(plot.id);
        layered.add(other.id);
      }
      if (plot.x < other.x + other.cols * 104 && plot.x + plot.cols * 104 > other.x &&
          plot.y + plot.rows * 27 < other.y + other.rows * 54 && plot.y + bottom > other.y) {
        layered.add(plot.id);
      }
    }
  }
  return layered;
}

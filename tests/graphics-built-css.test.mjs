import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

async function gameRules() {
  const directory = new URL("../dist/client/assets/", import.meta.url);
  const assets = (await readdir(directory)).filter((name) => /\.css$/.test(name));
  assert.ok(assets.length > 0, "Build the game before testing: production CSS is missing");
  const stylesheets = await Promise.all(assets.map((name) => readFile(new URL(name, directory), "utf8")));
  return stylesheets.flatMap((css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: match[1].split(",").map((selector) => selector.trim()),
    declarations: match[2],
  })));
}

test("built game styles preserve the standard backdrop-filter reset for every normal game panel", async () => {
  const rules = await gameRules();
  for (const selector of [
    ".hud",
    ".manager-section",
    ".utility-dock",
    ".worker-card",
    ".floating-panel",
    ".settings-dialog::backdrop",
  ]) {
    // Match a declaration boundary, so -webkit-backdrop-filter alone cannot pass.
    assert.ok(rules.some((rule) => rule.selectors.includes(selector)
      && /(?:^|;)\s*backdrop-filter\s*:\s*none\s*(?:;|$)/.test(rule.declarations)),
    `${selector} must retain standard backdrop-filter:none in the production CSS`);
  }
});

test("built game styles retain the baked plot image layer", async () => {
  const rules = await gameRules();
  const baked = rules.filter((rule) => rule.selectors.includes(".plot-baked"));
  assert.ok(baked.length > 0, "The production CSS must include .plot-baked");
  const declarations = baked.map((rule) => rule.declarations).join(";");
  assert.match(declarations, /(?:^|;)\s*position\s*:\s*absolute\s*(?:;|$)/);
  assert.match(declarations, /(?:^|;)\s*z-index\s*:\s*3\s*(?:;|$)/);
  assert.match(declarations, /(?:^|;)\s*pointer-events\s*:\s*none\s*(?:;|$)/);
});

import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the complete workshop scene", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Plot Workers · 增量工坊经营<\/title>/);
  assert.match(html, /Plot Workers/);
  assert.match(html, /采集区/);
  assert.match(html, /加工区/);
  assert.match(html, /生活区/);
  assert.match(html, /螺丝\/钢筋/);
  assert.doesNotMatch(html, /class="event-dock|class="event-toggle/);
  assert.doesNotMatch(html, /下一资源区|环境雷达|陨石预警|应急医疗|结构工程/);
  assert.match(html, /订单/);
  assert.match(html, /背包/);
  assert.match(html, /人物管理/);
  assert.doesNotMatch(html, /机器人管理/);
  assert.match(html, /机器人时间\/数量/);
  assert.match(html, /可以工作/);
  assert.match(html, /class="worker-image" src="\/worker\.png"/);
  assert.doesNotMatch(html, /class="(?:hair|face|torso|arm|leg|shoe)"/);
  assert.match(html, /class="plot-surface" src="\/plot-gather-8\.png"/);
  assert.doesNotMatch(html, /class="tile /);
  assert.match(html, /重新开始/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/);
});

test("bundles the background simulation worker", async () => {
  const assets = await readdir(new URL("../dist/client/assets/", import.meta.url));
  assert.ok(assets.some((name) => /^simulation\.worker-.*\.js$/.test(name)));
});

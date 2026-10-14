# Plot Workers

[在线体验](https://plotworkers.lazymicezhu.com/) · [English](./README.en.md)

《Plot Workers》是一款以地块建设和工人调度为核心的增量经营游戏。购买并安排各具性格的小人，采集原料、加工产品、组装商品，再通过市场与订单赚取金币。扩建工坊、研究科技、部署机器人，不断优化生产链，把几块小小的土地发展成高效运转的工业世界。

## 游戏特色

- 完整的“采集 → 加工 → 合成 → 出售或交付订单”生产循环
- 通过拖拽分配工人，并自由移动等距视角地块
- 工人的心情、属性、性格与休息系统
- 独立地块配方、批次生产、浮动市场和限时订单
- 机器人自动调度，以及生产工艺、自动管理、商业合作三类本轮研究
- 完成特殊物品奖励订单，同时获得更多金币及提升生产、机器人搬运与心情恢复效率的道具
- 无需账号的版本化本地存档

## 如何游玩

1. 将工人拖到采集区生产原料。
2. 把工人分配到加工区和合成区制造商品。
3. 出售商品或完成订单以获得金币。
4. 将疲惫的工人送往生活区。
5. 购买更多工人、地块、机器人和研究，不断扩大生产规模。

拖动画面空白处可移动视角，使用鼠标滚轮或 `+`、`-` 键缩放。按住并拖动地块可以重新布置工坊。

建造合成区后解锁订单，每180秒派发一张，最多同时保留两张。备齐所需商品后手动交付，即可领取订单标明的奖励。75%为普通金币订单，25%为特殊订单；特殊订单奖励同商品普通金币订单的1.5倍金币（向上取整），另加随机特殊物品×1。两种订单的金币均按交付时的市价和研究等级计算；特殊物品可在背包中按需使用。

研究分为生产工艺、自动管理、商业合作三组：采集工具与加工改良每级速度+10%，合成工程每级+15%，订单网络每级基础金币奖励+10%，均为五级上限。班组管理（3,000金币）解锁逐台机器人参数升级；生产计划（5,000金币）支持追踪一张订单、按缺口临时转产、交付或取消后恢复原配方。客户协商提供换单机会，交付保障延长新订单期限。全部研究本轮生效，转生后重置。

## 本地运行

需要 Node.js 22.13 或更高版本以及 npm。

```bash
npm install
npm run dev
```

常用命令：

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动本地开发服务器 |
| `npm run build` | 生成生产构建 |
| `npm run preview` | 预览已构建版本，固定地址 http://127.0.0.1:49224/ |
| `npm test` | 构建并运行自动化测试 |
| `npm run lint` | 运行代码质量检查 |
| `npm run deploy` | 构建并部署到 Cloudflare Workers |
| `npm run deploy:preview` | 构建并上传 Worker 预览版本 |

## 部署到 Cloudflare Workers

推荐使用 Cloudflare Workers。项目采用 Vinext 和 React Server Components，构建结果同时包含 Worker 服务端入口与静态资源。

### 从本机部署

首次使用时登录 Cloudflare，然后执行部署：

```bash
npx wrangler login
npm run deploy
```

Wrangler 会创建或更新名为 `plot-workers` 的 Worker，并显示对应的 `workers.dev` 地址。之后可以在 Cloudflare 控制台的 Worker 设置中绑定自定义域名。

### 从 GitHub 自动部署

1. 将仓库推送到 GitHub。
2. 在 Cloudflare 中进入 **Workers & Pages**，选择 **Create application**，然后导入该仓库。
3. 使用以下构建设置：

| 设置 | 值 |
| --- | --- |
| 根目录 | `/` |
| 生产分支 | `main` |
| 构建命令 | `npm run build` |
| 部署命令 | `npx wrangler deploy --config dist/server/wrangler.json` |
| 非生产分支部署命令 | `npx wrangler versions upload --config dist/server/wrangler.json` |

Cloudflare Workers Builds 可以自行管理部署令牌。如果改用 GitHub Actions，请将 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID` 保存在仓库 Secrets 中，绝对不要提交到代码仓库。

更多选项请参考 [Cloudflare Workers Builds 配置](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)和 [Vinext 部署说明](https://github.com/cloudflare/vinext#deployment)。

## Cloudflare Pages 可以吗？

当前项目不能不经修改直接上传到 Pages，因为构建结果包含服务端 Worker。只有完成独立的静态导出改造后才适合 Pages，包括移除仅限 Worker 的代码、验证后台模拟 Worker 的打包方式，并生成 `out` 等纯静态输出目录。

如果未来需要纯静态版本，请先完成上述改造，再参考 Cloudflare 的 [Next.js 静态导出指南](https://developers.cloudflare.com/pages/framework-guides/nextjs/deploy-a-static-nextjs-site/)。对当前代码而言，Workers 是直接且受支持的部署方式。

## 数据与隐私

- 游戏进度和显示偏好仅保存在当前浏览器中。
- 游戏无需账号，也未集成分析或遥测。
- 页面隐藏时模拟暂停，不计算离线收益。
- 本地环境变量、部署状态、日志和凭据均被排除在 Git 之外。

### 存档兼容

第10版存档增加研究实际投入、换单冷却与订单生产计划，兼容并自动迁移第1–9版存档。旧研究等级及历史投入保留；已有机器人参数升级的旧存档免费解锁班组管理。首次转生和包工头记录继续保留。

第8版存档取消环境系统，包括高资源区、陨石、陨石坑掉落、地块损毁、人物昏迷及相关研究。第1–7版旧存档会在加载时自动升级，受损地块恢复可用，昏迷或恢复中的人物恢复满心情。

已有金币、库存、地块、人物、生产批次、订单，以及合成工程和订单网络的研究等级都会保留。已移除研究的购买费用不返还，无需重新开局。

## 策划文档

- [当前玩法说明](./docs/%E5%BD%93%E5%89%8D%E7%8E%A9%E6%B3%95%E8%AF%B4%E6%98%8E.md)
- [经济与订单数值策划](./docs/%E7%BB%8F%E6%B5%8E%E4%B8%8E%E8%AE%A2%E5%8D%95%E6%95%B0%E5%80%BC%E7%AD%96%E5%88%92.md)

# Plot Workers

[English](./README.md)

《Plot Workers》是一款以地块建设和工人调度为核心的增量经营游戏。购买并安排各具性格的小人，采集原料、加工产品、组装商品，再通过市场与订单赚取金币。扩建工坊、研究科技、部署机器人，在资源区与陨石等随机事件中不断优化生产链，把几块小小的土地发展成高效运转的工业世界。

## 游戏特色

- 完整的“采集 → 加工 → 合成 → 出售或交付订单”生产循环
- 通过拖拽分配工人，并自由移动等距视角地块
- 工人的心情、属性、性格、休息与昏迷恢复系统
- 独立地块配方、批次生产、浮动市场和限时订单
- 机器人自动调度与永久研究升级
- 高资源区、陨石、废墟和特殊物品等环境事件
- 无需账号的版本化本地存档

## 如何游玩

1. 将工人拖到采集区生产原料。
2. 把工人分配到加工区和合成区制造商品。
3. 出售商品或完成订单以获得金币。
4. 将疲惫或受伤的工人送往生活区。
5. 购买更多工人、地块、机器人和研究，不断扩大生产规模。

拖动画面空白处可移动视角，使用鼠标滚轮或 `+`、`-` 键缩放。按住并拖动地块可以重新布置工坊。

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

## 策划文档

- [当前玩法说明](./docs/%E5%BD%93%E5%89%8D%E7%8E%A9%E6%B3%95%E8%AF%B4%E6%98%8E.md)
- [经济与订单数值策划](./docs/%E7%BB%8F%E6%B5%8E%E4%B8%8E%E8%AE%A2%E5%8D%95%E6%95%B0%E5%80%BC%E7%AD%96%E5%88%92.md)

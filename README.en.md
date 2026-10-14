# Plot Workers

[Play online](https://plotworkers.lazymicezhu.com/) · [中文说明](./README.md)

Plot Workers is an incremental management game about building production chains on a growing collection of plots. Recruit workers with different personalities, assign them to gather, process, synthesize, or rest, then reinvest the proceeds in new land, automation, robots, and permanent research.

## Features

- A complete gather → process → synthesize → sell/order production loop
- Drag-and-drop worker assignment and movable isometric plots
- Worker mood, attributes, personalities, and rest
- Per-plot recipes, batch production, market prices, and timed orders
- Robot dispatch automation, three standard research groups, and special plot unlocks
- Special orders that award extra coins plus items to boost production, robot transport, and mood recovery
- Order Refresh Tickets to fill an empty order slot and rare Golden Order Tickets to complete an order without materials
- Versioned local saves with no account required

## How to play

1. Drag workers onto gathering plots to produce raw materials.
2. Move them to processing and synthesis plots to create products.
3. Sell products or deliver orders to earn coins.
4. Send tired workers to living plots.
5. Expand with more workers, plots, robots, and research.

Drag an empty part of the scene to move the camera. Use the mouse wheel or the `+` and `-` keys to zoom. Press and drag a plot to reposition it.

Building a synthesis plot unlocks orders. A new order arrives every 180 seconds, with up to two active at once; deliver the required products manually to receive its displayed rewards. Regular coin orders make up 75% of orders. The other 25% are special orders, which award 1.5 times the regular coin reward for the same products (rounded up), plus one random special item. Both order types calculate coins using market prices and research levels at delivery. Use special items from the backpack when needed.

An Order Refresh Ticket immediately adds one order when you own a synthesis plot and have an empty order slot. It leaves the natural arrival timer and research replacement cooldown unchanged. A Golden Order Ticket, displayed with a gold name, completes a selected unexpired order without using materials and grants its full coin and special-item rewards. Within special-order item rewards, Can Opener, Smart Leader, and Holy Light each have a 25% chance, Order Refresh Ticket has 23%, and Golden Order Ticket has 2%. Older saves start with zero of each new ticket.

Research includes three standard groups—Production, Automation, and Commerce—plus Special Plots. Gathering Tools and Processing Improvements add 10% speed per level, Synthesis Engineering adds 15%, and Order Network adds 10% of the base coin reward; each has five levels. Team Management (3,000 coins) unlocks per-robot upgrades. Production Planning (5,000 coins) tracks one order, temporarily schedules recipes and upstream ingredients, then restores prior recipes after delivery or cancellation. Customer Negotiation unlocks order replacement; Delivery Assurance extends new deadlines. All research resets on rebirth.

Research → Special Plots offers one free 4×4 Fishing Pond, placed through the usual plot placement flow. Manually drag up to three workers onto the pond; they snap to available seats. Each round takes 60 seconds, or 30 seconds for Lazy workers, without consuming or restoring mood; workers can keep fishing at zero mood. Catches go directly into the game inventory, and the pond’s Harvest button shows the latest 20 outcomes with their ages.

## Local development

Requirements: Node.js 22.13 or newer and npm.

```bash
npm install
npm run dev
```

Useful commands:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local development server |
| `npm run build` | Create a production build |
| `npm run preview` | Preview the build at http://127.0.0.1:49224/ |
| `npm test` | Build and run the automated tests |
| `npm run lint` | Run the code quality checks |
| `npm run deploy` | Build and deploy to Cloudflare Workers |
| `npm run deploy:preview` | Build and upload a preview Worker version |

The preview uses finite resources by default; `?resources=infinite` opens the original unlimited mode. Saves and backups are separate. On the first finite-mode visit, the unlimited workshop is copied with processed goods, screws, and rebar cleared; coins, raw material, cans, and scheduler time are capped at 100,000, 10,000, 1,000, and 30 minutes. Production and consumption then follow normal rules, without resetting on reload.

## Deploy to Cloudflare Workers

Cloudflare Workers is the recommended deployment target. The project uses Vinext with React Server Components and produces a Worker entry point together with its static assets.

### Deploy from your computer

Authenticate once, then deploy:

```bash
npx wrangler login
npm run deploy
```

Wrangler creates or updates the `plot-workers` Worker and prints its `workers.dev` URL. Custom domains can be added later from the Worker settings in the Cloudflare dashboard.

### Automatic deployment from GitHub

1. Push the repository to GitHub.
2. In Cloudflare, open **Workers & Pages**, choose **Create application**, then import the repository.
3. Use the following build settings:

| Setting | Value |
| --- | --- |
| Root directory | `/` |
| Production branch | `main` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy --config dist/server/wrangler.json` |
| Non-production deploy command | `npx wrangler versions upload --config dist/server/wrangler.json` |

Cloudflare Workers Builds can manage its deployment token. If you use GitHub Actions instead, store `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository secrets—never commit them.

See the official [Cloudflare Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/) and [Vinext deployment guide](https://github.com/cloudflare/vinext#deployment) for additional options.

## What about Cloudflare Pages?

The current project should not be uploaded to Pages unchanged: its build output includes a server-side Worker. Pages is suitable only after a separate static-export conversion, including removing Worker-only code, verifying the simulation worker bundle, and producing a static output directory such as `out`.

If a fully static edition is needed, follow Cloudflare's [Next.js static export guide](https://developers.cloudflare.com/pages/framework-guides/nextjs/deploy-a-static-nextjs-site/) after completing that conversion. For the current codebase, Workers is the direct and supported route.

## Data and privacy

- Game progress and display preferences are stored locally in the browser.
- The game does not require an account and does not include analytics or telemetry.
- Simulation pauses while the page is hidden; there are no offline earnings.
- Local environment files, deployment state, logs, and credentials are excluded from Git.

### Save compatibility

Save version 11 adds the Fishing Pond unlock, seats, independent progress, and recent harvest history. Versions 1–10 migrate automatically and can unlock the free pond.

Save version 10 adds research investment history, replacement cooldowns, and persistent order production plans. Versions 1–9 migrate automatically, retaining old research levels and historical purchase value. Saves with existing robot parameter upgrades receive Team Management at no extra cost.

Save version 8 removes the environment system: resource zones, meteor strikes, crater drops, plot damage, worker injuries, and their related research. Saves from versions 1–7 upgrade automatically when loaded, restoring damaged plots and returning injured workers to full mood.

Existing coins, inventory, plots, workers, production batches, orders, and synthesis/order research levels are preserved. Removed research purchases are not refunded. No restart is required.

## Design documents

- [Current gameplay specification (Chinese)](./docs/%E5%BD%93%E5%89%8D%E7%8E%A9%E6%B3%95%E8%AF%B4%E6%98%8E.md)
- [Economy and order balancing (Chinese)](./docs/%E7%BB%8F%E6%B5%8E%E4%B8%8E%E8%AE%A2%E5%8D%95%E6%95%B0%E5%80%BC%E7%AD%96%E5%88%92.md)

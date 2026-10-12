import { cp, mkdir, mkdtemp } from "node:fs/promises";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startProdServer } from "../node_modules/vinext/dist/server/prod-server.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const snapshots = join(root, "outputs", "local-preview");
await mkdir(snapshots, { recursive: true });
const snapshot = await mkdtemp(join(snapshots, "build-"));
// Each preview owns only its snapshot; remove it when this server stops.
process.once("exit", () => rmSync(snapshot, { recursive: true, force: true }));
process.once("SIGINT", () => process.exit(130));
process.once("SIGTERM", () => process.exit(143));

// The server caches its module manifest. Serve client and server from the same
// immutable copy so another build cannot remove scripts this preview still uses.
await cp(join(root, "dist"), join(snapshot, "dist"), { recursive: true });
await startProdServer({
  host: "127.0.0.1",
  port: 49224,
  outDir: join(snapshot, "dist"),
});

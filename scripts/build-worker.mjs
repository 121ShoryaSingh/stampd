// Bundles the worker (and our own code it imports) into dist/worker.mjs; npm packages stay in node_modules.
// Run it with: node --conditions=react-server dist/worker.mjs
import { build } from "esbuild";

await build({
  entryPoints: { worker: "src/worker/index.ts" },
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm", // the generated Prisma client needs import.meta.url
  packages: "external",
  tsconfig: "tsconfig.json",
  sourcemap: true,
  logLevel: "info",
});

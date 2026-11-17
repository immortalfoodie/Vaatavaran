import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const ignored = new Set([
  ".git",
  "node_modules",
  "artifacts",
  "coverage",
  ".env",
]);
let bytes = 0,
  files = 0;
async function walk(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (
      ignored.has(item.name) ||
      (item.name.startsWith(".env.") && item.name !== ".env.example")
    )
      continue;
    const path = join(dir, item.name);
    if (item.isDirectory()) await walk(path);
    else {
      bytes += (await stat(path)).size;
      files++;
    }
  }
}
await walk(fileURLToPath(new URL("../", import.meta.url)));
console.log(
  `${files} source files; ${(bytes / 1000000).toFixed(3)} MB (limit: less than 10 MB).`,
);
if (bytes >= 10000000) process.exitCode = 1;

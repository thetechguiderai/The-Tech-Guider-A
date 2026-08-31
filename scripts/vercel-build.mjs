import { cp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "Public");
const output = path.join(root, "dist");

await rm(output, { recursive: true, force: true });
await cp(source, output, { recursive: true });

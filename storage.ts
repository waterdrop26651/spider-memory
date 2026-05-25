/** Spider Memory — JSON persistence with atomic writes */

import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { SpiderGraph } from "./types.js";
import { createGraph } from "./graph.js";

export async function loadGraph(path: string): Promise<SpiderGraph> {
  try {
    const data = await readFile(path, "utf-8");
    const parsed = JSON.parse(data) as SpiderGraph;
    // Ensure metadata defaults
    if (!parsed.metadata) {
      parsed.metadata = createGraph().metadata;
    }
    if (!parsed.nodes) parsed.nodes = {};
    if (!parsed.edges) parsed.edges = {};
    return parsed;
  } catch (err: any) {
    if (err.code === "ENOENT") {
      // Try backup
      const bakPath = path.replace(/\.json$/, ".json.bak");
      try {
        const bakData = await readFile(bakPath, "utf-8");
        return JSON.parse(bakData) as SpiderGraph;
      } catch {
        return createGraph();
      }
    }
    // Corrupted — try backup
    const bakPath = path.replace(/\.json$/, ".json.bak");
    try {
      const bakData = await readFile(bakPath, "utf-8");
      return JSON.parse(bakData) as SpiderGraph;
    } catch {
      return createGraph();
    }
  }
}

export async function saveGraph(graph: SpiderGraph, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });

  const tmpPath = path.replace(/\.json$/, ".json.tmp");
  const bakPath = path.replace(/\.json$/, ".json.bak");

  try {
    // Write to tmp
    await writeFile(tmpPath, JSON.stringify(graph, null, 2), "utf-8");

    // Backup current
    try {
      await rename(path, bakPath);
    } catch {
      // No existing file to backup — fine
    }

    // Atomic replace
    await rename(tmpPath, path);
  } catch (err) {
    // Cleanup tmp on failure
    try {
      await unlink(tmpPath);
    } catch {}
    throw err;
  }
}

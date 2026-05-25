/** Spider Memory — graph engine: nodes, edges, BFS walk, search, maintenance */

import { randomUUID } from "node:crypto";
import type {
  SpiderNode,
  SpiderEdge,
  SpiderGraph,
  GraphMetadata,
  WalkStep,
  WalkResult,
} from "./types.js";

// ─── Factory ───

export function createGraph(): SpiderGraph {
  return {
    nodes: {},
    edges: {},
    metadata: {
      version: 2,
      createdAt: Date.now(),
      lastExhaleAt: null,
      lastPatrolAt: null,
      relationshipPhase: "acquaintance",
      nestRadius: 2,
    },
  };
}

export function generateId(): string {
  return randomUUID();
}

// ─── Node / Edge CRUD ───

export function addNode(graph: SpiderGraph, node: SpiderNode): void {
  graph.nodes[node.id] = node;
}

export function addEdge(graph: SpiderGraph, edge: SpiderEdge): void {
  // Prevent self-loops
  if (edge.fromId === edge.toId) return;

  // Prevent edges to non-existent nodes
  if (!graph.nodes[edge.fromId] || !graph.nodes[edge.toId]) return;

  if (!graph.edges[edge.fromId]) graph.edges[edge.fromId] = [];

  // Coalesce duplicate (same from, to, type)
  for (const existing of graph.edges[edge.fromId]) {
    if (existing.toId === edge.toId && existing.edgeType === edge.edgeType) {
      existing.weight += edge.weight;
      // Sync reverse edge weight
      for (const rev of graph.edges[edge.toId] ?? []) {
        if (rev.toId === edge.fromId && rev.edgeType === edge.edgeType) {
          rev.weight += edge.weight;
          break;
        }
      }
      return;
    }
  }

  graph.edges[edge.fromId].push(edge);

  // Auto-create reverse edge
  const reverse: SpiderEdge = {
    edgeId: generateId(),
    fromId: edge.toId,
    toId: edge.fromId,
    weight: edge.weight,
    edgeType: edge.edgeType,
    createdAt: edge.createdAt,
    evidenceRef: edge.evidenceRef,
    isSeed: edge.isSeed,
  };

  if (!graph.edges[reverse.fromId]) graph.edges[reverse.fromId] = [];

  for (const existing of graph.edges[reverse.fromId]) {
    if (existing.toId === reverse.toId && existing.edgeType === reverse.edgeType) {
      existing.weight += reverse.weight;
      return;
    }
  }

  graph.edges[reverse.fromId].push(reverse);
}

export function touchEdge(graph: SpiderGraph, fromId: string, toId: string): void {
  // Find forward edge
  for (const edge of graph.edges[fromId] ?? []) {
    if (edge.toId === toId) {
      edge.weight += 1;
      break;
    }
  }
  // Find reverse edge
  for (const edge of graph.edges[toId] ?? []) {
    if (edge.toId === fromId) {
      edge.weight += 1;
      break;
    }
  }
}

export function getNodeDegree(graph: SpiderGraph, nodeId: string): number {
  const seen = new Set<string>();
  for (const edge of graph.edges[nodeId] ?? []) {
    const pair = [edge.fromId, edge.toId].sort().join(":");
    seen.add(pair);
  }
  return seen.size;
}

// ─── Text utilities ───

const PUNCT_RE = /[.,!?;:"'()[\]{}]/g;

export function stripPunct(word: string): string {
  return word.replace(PUNCT_RE, "").toLowerCase();
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  let overlap = 0;
  for (const w of a) if (b.has(w)) overlap++;
  const union = a.size + b.size - overlap;
  return union === 0 ? 0 : overlap / union;
}

function tokenize(text: string): Set<string> {
  const words = new Set<string>();
  for (const raw of text.toLowerCase().split(/\s+/)) {
    const clean = stripPunct(raw);
    if (clean.length > 0) words.add(clean);
  }
  return words;
}

// ─── Search ───

export function findNodeByTopic(
  graph: SpiderGraph,
  topic: string,
  threshold = 0.25,
): string | null {
  const topicLower = topic.toLowerCase().trim();
  if (!topicLower) return null;

  // Exact match
  for (const [nid, node] of Object.entries(graph.nodes)) {
    if (node.summary.toLowerCase().trim() === topicLower) return nid;
  }

  // Substring match
  for (const [nid, node] of Object.entries(graph.nodes)) {
    if (node.summary.toLowerCase().includes(topicLower)) return nid;
  }

  // Jaccard match
  const topicWords = tokenize(topicLower);
  let bestScore = 0;
  let bestId: string | null = null;

  for (const [nid, node] of Object.entries(graph.nodes)) {
    const nodeWords = tokenize(node.summary);
    const score = jaccard(topicWords, nodeWords);
    if (score > bestScore) {
      bestScore = score;
      bestId = nid;
    }
  }

  return bestScore > threshold ? bestId : null;
}

export function getMostConnected(graph: SpiderGraph, n = 5): SpiderNode[] {
  const degrees = Object.keys(graph.nodes).map((nid) => ({
    nid,
    degree: getNodeDegree(graph, nid),
  }));
  degrees.sort((a, b) => b.degree - a.degree);
  return degrees.slice(0, n).map((d) => graph.nodes[d.nid]);
}

export function findIslands(graph: SpiderGraph): SpiderNode[] {
  return Object.values(graph.nodes).filter(
    (n) => n.lastWalkedAt === n.createdAt,
  );
}

/** Remove edges that reference non-existent nodes and clean up empty edge arrays */
export function repairGraph(graph: SpiderGraph): { removedEdges: number; removedKeys: number } {
  const nodeIds = new Set(Object.keys(graph.nodes));
  let removedEdges = 0;
  const keysToRemove: string[] = [];

  for (const [fromId, edges] of Object.entries(graph.edges)) {
    // Remove edges from nonexistent nodes
    if (!nodeIds.has(fromId)) {
      removedEdges += edges.length;
      keysToRemove.push(fromId);
      continue;
    }
    // Remove edges to nonexistent nodes
    const before = edges.length;
    graph.edges[fromId] = edges.filter((e) => nodeIds.has(e.toId));
    removedEdges += before - graph.edges[fromId].length;
    if (graph.edges[fromId].length === 0) {
      keysToRemove.push(fromId);
    }
  }

  for (const key of keysToRemove) {
    delete graph.edges[key];
  }

  return { removedEdges, removedKeys: keysToRemove.length };
}

// ─── BFS Walk ───

export function walk(
  graph: SpiderGraph,
  startId: string,
  steps = 3,
  topN = 3,
  edgeTypeWeights?: Record<string, number>,
  decayFactor = 1.0,
): WalkResult | null {
  if (!graph.nodes[startId]) return null;

  const now = Date.now();
  const visited = new Map<string, { node: SpiderNode; step: number; via: SpiderEdge | null }>();
  const activationScores: Record<string, number> = {};
  let currentLayer = [startId];

  for (let step = 0; step < steps; step++) {
    const nextLayer: string[] = [];

    for (const nodeId of currentLayer) {
      if (visited.has(nodeId)) continue;
      const node = graph.nodes[nodeId];
      if (!node || node.layer === "cold") continue;

      const edgesPool = (graph.edges[nodeId] ?? []).filter((e) => !e.isSeed);

      // Sort by effective weight (with optional type weight and decay)
      const sorted = edgesPool.sort((a, b) => {
        const wa =
          a.weight *
          (edgeTypeWeights?.[a.edgeType] ?? 1.0) *
          decayFactor ** step;
        const wb =
          b.weight *
          (edgeTypeWeights?.[b.edgeType] ?? 1.0) *
          decayFactor ** step;
        return wb - wa;
      });
      const topEdges = sorted.slice(0, topN);

      if (topEdges.length > 0) {
        const best = topEdges[0];
        const ew =
          best.weight * (edgeTypeWeights?.[best.edgeType] ?? 1.0);
        activationScores[nodeId] = ew * decayFactor ** step;
      } else {
        activationScores[nodeId] = 0;
      }

      visited.set(nodeId, {
        node,
        step,
        via: topEdges[0] ?? null,
      });
      node.lastWalkedAt = now;

      for (const edge of topEdges) {
        if (!visited.has(edge.toId)) {
          nextLayer.push(edge.toId);
        }
      }
    }

    currentLayer = nextLayer;
  }

  if (visited.size === 0) return null;

  const stepsList: WalkStep[] = [];
  for (const [nodeId, { node, step, via }] of visited) {
    stepsList.push({ node, step, viaEdge: via });
  }

  return {
    startNode: graph.nodes[startId],
    steps: stepsList,
    activationScores,
  };
}

// ─── Maintenance ───

export function decayEdges(
  graph: SpiderGraph,
  decayFactor: number,
  minWeight: number,
): number {
  let count = 0;
  for (const edges of Object.values(graph.edges)) {
    for (const edge of edges) {
      if (edge.weight > minWeight) {
        edge.weight = Math.max(edge.weight * decayFactor, minWeight);
        count++;
      }
    }
  }
  return count;
}

export function forgetEdges(graph: SpiderGraph, threshold: number): number {
  let removed = 0;
  const emptyKeys: string[] = [];

  for (const [fromId, edges] of Object.entries(graph.edges)) {
    const before = edges.length;
    graph.edges[fromId] = edges.filter((e) => e.weight >= threshold);
    removed += before - graph.edges[fromId].length;
    if (graph.edges[fromId].length === 0) emptyKeys.push(fromId);
  }

  for (const key of emptyKeys) {
    delete graph.edges[key];
  }

  return removed;
}

export function archiveColdLayer(
  graph: SpiderGraph,
  thresholdMonths = 6,
): { nodesArchived: number; edgesArchived: number } {
  const cutoff = Date.now() - thresholdMonths * 30 * 86400 * 1000;
  let nodesArchived = 0;
  let edgesArchived = 0;
  const toArchive: string[] = [];

  for (const [nid, node] of Object.entries(graph.nodes)) {
    if (node.layer === "hot" && node.lastWalkedAt < cutoff && !node.isNest) {
      toArchive.push(nid);
    }
  }

  for (const nid of toArchive) {
    graph.nodes[nid].layer = "cold";
    nodesArchived++;
    if (graph.edges[nid]) {
      edgesArchived += graph.edges[nid].length;
      delete graph.edges[nid];
    }
  }

  // Remove dangling references to archived nodes
  for (const nid of toArchive) {
    for (const otherId of Object.keys(graph.edges)) {
      graph.edges[otherId] = graph.edges[otherId].filter(
        (e) => e.toId !== nid && e.fromId !== nid,
      );
    }
  }

  return { nodesArchived, edgesArchived };
}

export function mergeNodes(
  graph: SpiderGraph,
  keepId: string,
  removeId: string,
): boolean {
  if (keepId === removeId) return false;
  if (!graph.nodes[keepId] || !graph.nodes[removeId]) return false;

  const keepNode = graph.nodes[keepId];
  const removeNode = graph.nodes[removeId];

  // Keep the longer summary
  if (removeNode.summary.length > keepNode.summary.length) {
    keepNode.summary = removeNode.summary;
    keepNode.rawSource = removeNode.rawSource;
  }

  // Transfer edges from removed node
  const removeEdges = graph.edges[removeId] ?? [];
  const keepEdges = graph.edges[keepId] ?? [];
  const keepEdgeMap = new Map<string, number>();
  keepEdges.forEach((e, idx) => {
    keepEdgeMap.set(`${e.toId}:${e.edgeType}`, idx);
  });

  for (const re of removeEdges) {
    if (re.toId === keepId) continue;
    const key = `${re.toId}:${re.edgeType}`;
    const existingIdx = keepEdgeMap.get(key);
    if (existingIdx !== undefined) {
      keepEdges[existingIdx].weight = Math.max(
        keepEdges[existingIdx].weight,
        re.weight,
      );
    } else {
      const newEdge: SpiderEdge = {
        edgeId: generateId(),
        fromId: keepId,
        toId: re.toId,
        weight: re.weight,
        edgeType: re.edgeType,
        createdAt: re.createdAt,
        evidenceRef: re.evidenceRef,
        isSeed: re.isSeed,
      };
      keepEdges.push(newEdge);
      keepEdgeMap.set(key, keepEdges.length - 1);
    }
  }
  graph.edges[keepId] = keepEdges;

  // Update references from other nodes
  for (const otherId of Object.keys(graph.edges)) {
    if (otherId === keepId) continue;
    graph.edges[otherId] = graph.edges[otherId]
      .filter((e) => !(e.fromId === removeId))
      .map((e) => {
        if (e.toId === removeId) {
          return {
            ...e,
            toId: keepId,
            edgeId: generateId(),
          };
        }
        return e;
      });
  }

  delete graph.nodes[removeId];
  return true;
}

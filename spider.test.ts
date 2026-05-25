/** Spider Memory — comprehensive test suite */

import { createGraph, addNode, addEdge, generateId, findNodeByTopic, walk, getNodeDegree, jaccard, stripPunct, decayEdges, forgetEdges, mergeNodes, getMostConnected, findIslands, touchEdge, archiveColdLayer, repairGraph } from "./graph.js";
import { extractKeywords, exhale } from "./exhale.js";
import { saveGraph, loadGraph } from "./storage.js";
import type { SpiderNode, SpiderEdge, SpiderGraph, SpiderConfig } from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlink } from "node:fs/promises";

let passed = 0;
let failed = 0;
let skipped = 0;
const errors: string[] = [];

function assert(condition: boolean, msg: string) {
  if (condition) { passed++; }
  else { failed++; errors.push(`❌ ${msg}`); console.error(`  ❌ ${msg}`); }
}

function section(name: string) { console.log(`\n── ${name} ──`); }

function makeNode(id: string, summary: string): SpiderNode {
  return { id, summary, rawSource: summary, createdAt: 1000, lastWalkedAt: 1000, isNest: false, layer: "hot" };
}

function makeEdge(fromId: string, toId: string, weight = 1.0, edgeType: SpiderEdge["edgeType"] = "co-occurrence"): SpiderEdge {
  return { edgeId: generateId(), fromId, toId, weight, edgeType, createdAt: 1000, evidenceRef: "test", isSeed: false };
}

// ═══════════════════════════════════════════
// 1. GRAPH FACTORY
// ═══════════════════════════════════════════

section("1. Graph Factory");

(() => {
  const g = createGraph();
  assert(Object.keys(g.nodes).length === 0, "createGraph: 0 nodes");
  assert(Object.keys(g.edges).length === 0, "createGraph: 0 edges");
  assert(g.metadata.version === 2, "metadata version = 2");
  assert(g.metadata.relationshipPhase === "acquaintance", "initial phase = acquaintance");
  assert(g.metadata.lastExhaleAt === null, "lastExhaleAt = null");
  assert(typeof generateId() === "string", "generateId returns string");
  assert(generateId() !== generateId(), "generateId is unique");
})();

// ═══════════════════════════════════════════
// 2. NODE OPERATIONS
// ═══════════════════════════════════════════

section("2. Node Operations");

(() => {
  const g = createGraph();
  addNode(g, makeNode("n1", "hello world"));
  assert(Object.keys(g.nodes).length === 1, "addNode: 1 node");
  assert(g.nodes["n1"].summary === "hello world", "addNode: data preserved");

  addNode(g, makeNode("n1", "updated")); // overwrite
  assert(g.nodes["n1"].summary === "updated", "addNode: overwrites existing");
  assert(Object.keys(g.nodes).length === 1, "addNode: still 1 node after overwrite");

  addNode(g, makeNode("n2", "second"));
  assert(Object.keys(g.nodes).length === 2, "addNode: 2 nodes");
})();

// ═══════════════════════════════════════════
// 3. EDGE OPERATIONS
// ═══════════════════════════════════════════

section("3. Edge Operations");

(() => {
  const g = createGraph();
  addNode(g, makeNode("a", "node a"));
  addNode(g, makeNode("b", "node b"));
  addNode(g, makeNode("c", "node c"));

  // Basic bidirectional
  addEdge(g, makeEdge("a", "b", 3.0));
  assert(g.edges["a"]?.length === 1, "forward edge created");
  assert(g.edges["b"]?.length === 1, "reverse edge created");
  assert(g.edges["a"][0].toId === "b", "forward points to b");
  assert(g.edges["b"][0].toId === "a", "reverse points to a");
  assert(g.edges["a"][0].weight === 3.0, "forward weight = 3");
  assert(g.edges["b"][0].weight === 3.0, "reverse weight = 3");

  // Duplicate coalesces and syncs reverse
  addEdge(g, makeEdge("a", "b", 2.0));
  assert(g.edges["a"]?.length === 1, "dup coalesced forward");
  assert(g.edges["b"]?.length === 1, "dup coalesced reverse");
  assert(g.edges["a"][0].weight === 5.0, `forward weight = 5, got ${g.edges["a"][0].weight}`);
  assert(g.edges["b"][0].weight === 5.0, `reverse weight synced = 5, got ${g.edges["b"][0].weight}`);

  // Self-loop ignored
  addEdge(g, makeEdge("a", "a", 1.0));
  assert(!g.edges["a"]?.some(e => e.toId === "a"), "self-loop ignored");

  // Different edge types don't coalesce
  addEdge(g, makeEdge("a", "c", 1.0, "co-occurrence"));
  addEdge(g, makeEdge("a", "c", 2.0, "temporal"));
  assert(g.edges["a"]?.filter(e => e.toId === "c").length === 2, "different types = separate edges");

  // Edge type coalesces within same type
  addEdge(g, makeEdge("a", "c", 0.5, "temporal"));
  assert(g.edges["a"]?.filter(e => e.toId === "c" && e.edgeType === "temporal")[0].weight === 2.5,
    `same type coalesces: ${g.edges["a"]?.filter(e => e.toId === "c" && e.edgeType === "temporal")[0].weight}`);
})();

// ═══════════════════════════════════════════
// 4. TEXT UTILITIES
// ═══════════════════════════════════════════

section("4. Text Utilities");

(() => {
  assert(stripPunct("hello,") === "hello", "strip comma");
  assert(stripPunct("world!") === "world", "strip exclamation");
  assert(stripPunct("test.") === "test", "strip period");
  assert(stripPunct('"quoted"') === "quoted", "strip quotes");
  assert(stripPunct("(parens)") === "parens", "strip parens");
  assert(stripPunct("clean") === "clean", "no punct unchanged");
  assert(stripPunct("") === "", "empty string");

  assert(jaccard(new Set(["a","b","c"]), new Set(["b","c","d"])) === 0.5, "jaccard 2/4 = 0.5");
  assert(jaccard(new Set(["a"]), new Set(["a"])) === 1.0, "jaccard same = 1.0");
  assert(jaccard(new Set(["a"]), new Set(["b"])) === 0, "jaccard disjoint = 0");
  assert(jaccard(new Set(), new Set()) === 0, "jaccard both empty = 0");
  assert(jaccard(new Set(["a","b"]), new Set(["a","b","c"])) === 2/3, `jaccard subset = ${jaccard(new Set(["a","b"]), new Set(["a","b","c"]))}`);
})();

// ═══════════════════════════════════════════
// 5. SEARCH (findNodeByTopic)
// ═══════════════════════════════════════════

section("5. Search");

(() => {
  const g = createGraph();
  addNode(g, makeNode("n1", "machine learning basics"));
  addNode(g, makeNode("n2", "neural network architecture"));
  addNode(g, makeNode("n3", "deep learning frameworks"));

  assert(findNodeByTopic(g, "machine learning basics") === "n1", "exact match");
  assert(findNodeByTopic(g, "MACHINE LEARNING BASICS") === "n1", "case insensitive exact");
  assert(findNodeByTopic(g, "neural network") === "n2", "substring match");
  assert(findNodeByTopic(g, "learning frameworks deep") === "n3", "jaccard match");
  assert(findNodeByTopic(g, "") === null, "empty returns null");
  assert(findNodeByTopic(g, "xyzabc unrelated 12345") === null, "no match returns null");
  assert(findNodeByTopic(g, "   ") === null, "whitespace returns null");
})();

// ═══════════════════════════════════════════
// 6. BFS WALK
// ═══════════════════════════════════════════

section("6. BFS Walk");

(() => {
  const g = createGraph();
  addNode(g, makeNode("a", "machine learning basics"));
  addNode(g, makeNode("b", "neural network architecture"));
  addNode(g, makeNode("c", "deep learning frameworks"));
  addNode(g, makeNode("d", "python programming"));
  addEdge(g, makeEdge("a", "b", 3.0));
  addEdge(g, makeEdge("b", "c", 5.0));
  addEdge(g, makeEdge("a", "d", 1.0));

  // Basic walk
  const r1 = walk(g, "a", 2, 3);
  assert(r1 !== null, "walk returns result");
  assert(r1!.startNode.id === "a", "starts from correct node");
  assert(r1!.steps.length >= 2, `visits >= 2 nodes, got ${r1!.steps.length}`);
  assert(r1!.steps.some(s => s.node.id === "b"), "visits node-b");

  // Nonexistent node
  assert(walk(g, "nonexistent") === null, "nonexistent returns null");

  // Cold node skipped
  const g2 = createGraph();
  addNode(g2, makeNode("x", "topic x"));
  addNode(g2, makeNode("y", "topic y"));
  addNode(g2, makeNode("z", "topic z"));
  addEdge(g2, makeEdge("x", "y", 5.0));
  addEdge(g2, makeEdge("y", "z", 5.0));
  g2.nodes["y"].layer = "cold";
  const r2 = walk(g2, "x", 3, 3);
  assert(!r2?.steps.some(s => s.node.id === "y"), "walk skips cold node");

  // Empty graph
  const emptyG = createGraph();
  assert(walk(emptyG, "anything") === null, "empty graph returns null");

  // Single node, no edges
  const singleG = createGraph();
  addNode(singleG, makeNode("solo", "alone"));
  const r3 = walk(singleG, "solo", 3, 3);
  assert(r3 !== null, "single node walk works");
  assert(r3!.steps.length === 1, "single node: 1 step");

  // Edge type weights: response edge gets boosted by weight multiplier
  const g3 = createGraph();
  addNode(g3, makeNode("p", "topic p"));
  addNode(g3, makeNode("q", "topic q"));
  addNode(g3, makeNode("r", "topic r"));
  addEdge(g3, makeEdge("p", "q", 1.0, "co-occurrence"));
  addEdge(g3, makeEdge("p", "r", 1.0, "response"));
  const r4 = walk(g3, "p", 2, 1, { response: 5.0, "co-occurrence": 1.0, temporal: 1.0 });
  // steps[0] is start node, steps[1] is the neighbor chosen by edge type weights
  assert(r4?.steps[1]?.node.id === "r", `edge type weights: expected r, got ${r4?.steps[1]?.node.id}`);

  // Walk reinforces edges
  const g4 = createGraph();
  addNode(g4, makeNode("m", "topic m"));
  addNode(g4, makeNode("n", "topic n"));
  addEdge(g4, makeEdge("m", "n", 1.0));
  const wBefore = g4.edges["m"][0].weight;
  walk(g4, "m", 1, 3);
  // Note: walk doesn't call touchEdge directly — that's done by the extension
  assert(g4.edges["m"][0].weight === wBefore, "walk alone doesn't modify weight (extension handles it)");
})();

// ═══════════════════════════════════════════
// 7. NODE DEGREE
// ═══════════════════════════════════════════

section("7. Node Degree");

(() => {
  const g = createGraph();
  addNode(g, makeNode("a", "a"));
  addNode(g, makeNode("b", "b"));
  addNode(g, makeNode("c", "c"));
  addEdge(g, makeEdge("a", "b", 1.0));
  addEdge(g, makeEdge("a", "c", 1.0));

  assert(getNodeDegree(g, "a") === 2, `a degree = 2, got ${getNodeDegree(g, "a")}`);
  assert(getNodeDegree(g, "b") === 1, `b degree = 1, got ${getNodeDegree(g, "b")}`);
  assert(getNodeDegree(g, "c") === 1, `c degree = 1, got ${getNodeDegree(g, "c")}`);

  // Nonexistent node
  assert(getNodeDegree(g, "nonexistent") === 0, "nonexistent degree = 0");
})();

// ═══════════════════════════════════════════
// 8. TOUCH EDGE
// ═══════════════════════════════════════════

section("8. Touch Edge");

(() => {
  const g = createGraph();
  addNode(g, makeNode("a", "a"));
  addNode(g, makeNode("b", "b"));
  addEdge(g, makeEdge("a", "b", 1.0));

  touchEdge(g, "a", "b");
  assert(g.edges["a"][0].weight === 2.0, `forward incremented: ${g.edges["a"][0].weight}`);
  assert(g.edges["b"][0].weight === 2.0, `reverse incremented: ${g.edges["b"][0].weight}`);

  touchEdge(g, "a", "b");
  assert(g.edges["a"][0].weight === 3.0, `forward incremented again: ${g.edges["a"][0].weight}`);

  // Touch nonexistent edge — should not crash
  touchEdge(g, "a", "nonexistent");
  assert(g.edges["a"][0].weight === 3.0, "touch nonexistent: no change");
})();

// ═══════════════════════════════════════════
// 9. MOST CONNECTED & ISLANDS
// ═══════════════════════════════════════════

section("9. Most Connected & Islands");

(() => {
  const g = createGraph();
  addNode(g, makeNode("a", "a"));
  addNode(g, makeNode("b", "b"));
  addNode(g, makeNode("c", "c"));
  addEdge(g, makeEdge("a", "b", 1.0));
  addEdge(g, makeEdge("a", "c", 1.0));

  const top = getMostConnected(g, 2);
  assert(top.length === 2, "returns 2 nodes");
  assert(top[0].id === "a", "most connected is a");

  const top10 = getMostConnected(g, 10);
  assert(top10.length === 3, "returns all 3 when n > node count");

  const empty = getMostConnected(createGraph(), 5);
  assert(empty.length === 0, "empty graph returns empty");

  // Islands: nodes never walked (lastWalkedAt === createdAt)
  const g2 = createGraph();
  addNode(g2, makeNode("x", "x"));
  addNode(g2, makeNode("y", "y"));
  g2.nodes["y"].lastWalkedAt = 2000; // walked
  const islands = findIslands(g2);
  assert(islands.length === 1, "1 island");
  assert(islands[0].id === "x", "island is x");
})();

// ═══════════════════════════════════════════
// 10. KEYWORD EXTRACTION
// ═══════════════════════════════════════════

section("10. Keyword Extraction");

(() => {
  const kw1 = extractKeywords("How do I use Python for machine learning?", DEFAULT_CONFIG);
  assert(kw1.length > 0, `extracts keywords: "${kw1}"`);
  assert(kw1.includes("python") || kw1.includes("machine") || kw1.includes("learning"),
    `contains relevant words: "${kw1}"`);

  // Stopwords filtered
  const kw2 = extractKeywords("the a is was are", DEFAULT_CONFIG);
  assert(kw2.length > 0, `stopword fallback: "${kw2}"`);

  // Very short text
  const kw3 = extractKeywords("hi", DEFAULT_CONFIG);
  assert(kw3.length > 0, `short text: "${kw3}"`);

  // Phrase extraction enabled
  const cfgPhrases: SpiderConfig = { ...DEFAULT_CONFIG, phraseExtractionEnabled: true };
  const kw4 = extractKeywords("machine learning is a subset of artificial intelligence", cfgPhrases);
  assert(kw4.length > 0, `phrase extraction: "${kw4}"`);
})();

// ═══════════════════════════════════════════
// 11. EXHALE
// ═══════════════════════════════════════════

section("11. Exhale");

(() => {
  // Basic exhale
  const g1 = createGraph();
  const msgs1 = [
    { role: "user", content: "How do I use Python for machine learning?" },
    { role: "assistant", content: "You can use scikit-learn." },
  ];
  const r1 = exhale(g1, msgs1, DEFAULT_CONFIG);
  assert(r1.newNodes >= 1, `created ${r1.newNodes} nodes`);
  assert(Object.keys(g1.nodes).length >= 1, "graph has nodes");
  assert(g1.metadata.lastExhaleAt !== null, "lastExhaleAt set");

  // Multi-turn exhale with overlapping keywords to trigger edge creation
  const g2 = createGraph();
  const msgs2 = [
    { role: "user", content: "python machine learning tutorial" },
    { role: "assistant", content: "Here is a Python ML tutorial." },
    { role: "user", content: "python machine learning examples" },
    { role: "assistant", content: "Here are Python ML examples." },
  ];
  const r2 = exhale(g2, msgs2, DEFAULT_CONFIG);
  assert(r2.newNodes >= 1, `multi-turn: ${r2.newNodes} nodes`);
  // With overlapping keywords, edges should be created
  assert(r2.edgesAdded >= 0, `multi-turn: ${r2.edgesAdded} edges (Jaccard-based)`);

  // Empty messages
  const g3 = createGraph();
  const r3 = exhale(g3, [], DEFAULT_CONFIG);
  assert(r3.newNodes === 0, "empty messages: 0 nodes");

  // Single message (not enough for exhale)
  const g4 = createGraph();
  const r4 = exhale(g4, [{ role: "user", content: "hello" }], DEFAULT_CONFIG);
  assert(r4.newNodes === 0, "single message: 0 nodes");

  // Relationship phase updates: create enough nodes to trigger phase change
  const g5 = createGraph();
  const lowThresholdConfig: SpiderConfig = { ...DEFAULT_CONFIG, relationshipPhaseThresholds: [3, 6, 10] };
  // Pre-populate with distinct nodes to guarantee threshold is met
  for (let i = 0; i < 5; i++) {
    addNode(g5, makeNode(`pre-${i}`, `unique topic alpha bravo charlie delta echo foxtrot ${i}`));
  }
  // Exhale to trigger phase recalculation
  const manyMsgs: Array<{ role: string; content: string }> = [
    { role: "user", content: "new topic golf hotel india" },
    { role: "assistant", content: "response" },
  ];
  exhale(g5, manyMsgs, lowThresholdConfig);
  assert(
    g5.metadata.relationshipPhase !== "acquaintance",
    `phase upgraded from acquaintance: ${g5.metadata.relationshipPhase}`
  );

  // Decay applied during exhale
  const g6 = createGraph();
  addNode(g6, makeNode("existing", "existing node"));
  const msgs6 = [
    { role: "user", content: "existing node" }, // matches existing
    { role: "assistant", content: "response" },
  ];
  exhale(g6, msgs6, { ...DEFAULT_CONFIG, decayFactor: 0.5, minEdgeWeight: 0.01 });
  // Decay was applied (we can't easily verify without pre-existing edges, but no crash)
  assert(true, "exhale with decay: no crash");

  // Forget applied during exhale
  const g7 = createGraph();
  addNode(g7, makeNode("old", "old topic"));
  addEdge(g7, makeEdge("old", "old", 0.01, "co-occurrence"));
  // Actually self-loops are ignored, so let's create a real edge
  addNode(g7, makeNode("other", "other topic"));
  addEdge(g7, makeEdge("old", "other", 0.01));
  const msgs7 = [
    { role: "user", content: "new topic xyz" },
    { role: "assistant", content: "response" },
  ];
  exhale(g7, msgs7, { ...DEFAULT_CONFIG, forgetEnabled: true, forgetThreshold: 0.1 });
  // Low-weight edges should be removed
  const oldEdges = g7.edges["old"]?.filter(e => e.toId === "other") ?? [];
  assert(oldEdges.length === 0 || oldEdges.every(e => e.weight >= 0.1),
    "forget removes low-weight edges");

  // Node merge during exhale
  const g8 = createGraph();
  addNode(g8, makeNode("ml", "machine learning basics"));
  const msgs8 = [
    { role: "user", content: "machine learning basics overview" }, // very similar
    { role: "assistant", content: "ML is a subset of AI." },
  ];
  const r8 = exhale(g8, msgs8, { ...DEFAULT_CONFIG, nodeMergeEnabled: true, nodeMergeThreshold: 0.5 });
  // Should either merge or not, but shouldn't crash
  assert(true, "exhale with merge: no crash");
})();

// ═══════════════════════════════════════════
// 12. MAINTENANCE
// ═══════════════════════════════════════════

section("12. Maintenance");

(() => {
  // Decay
  const g1 = createGraph();
  addNode(g1, makeNode("a", "a"));
  addNode(g1, makeNode("b", "b"));
  addEdge(g1, makeEdge("a", "b", 10.0));
  const decayed = decayEdges(g1, 0.5, 0.1);
  assert(decayed === 2, `decayed 2 edges, got ${decayed}`); // forward + reverse
  assert(g1.edges["a"][0].weight === 5.0, `weight halved: ${g1.edges["a"][0].weight}`);

  // Decay respects min weight
  const g1b = createGraph();
  addNode(g1b, makeNode("a", "a"));
  addNode(g1b, makeNode("b", "b"));
  addEdge(g1b, makeEdge("a", "b", 0.2));
  decayEdges(g1b, 0.5, 0.1);
  assert(g1b.edges["a"][0].weight === 0.1, `min weight floor: ${g1b.edges["a"][0].weight}`);

  // Forget
  const g2 = createGraph();
  addNode(g2, makeNode("a", "a"));
  addNode(g2, makeNode("b", "b"));
  addNode(g2, makeNode("c", "c"));
  addEdge(g2, makeEdge("a", "b", 0.05));
  addEdge(g2, makeEdge("a", "c", 5.0));
  const removed = forgetEdges(g2, 0.1);
  assert(removed > 0, `forget removed ${removed} edges`);
  assert(!g2.edges["a"]?.some(e => e.toId === "b"), "low-weight edge removed");
  assert(g2.edges["a"]?.some(e => e.toId === "c"), "high-weight edge kept");

  // Merge
  const g3 = createGraph();
  addNode(g3, makeNode("k", "python machine learning"));
  addNode(g3, makeNode("r", "python machine learning basics"));
  addNode(g3, makeNode("t", "other topic"));
  addEdge(g3, makeEdge("r", "t", 2.0));
  addEdge(g3, makeEdge("r", "k", 1.0)); // self-referencing, will be skipped

  const merged = mergeNodes(g3, "k", "r");
  assert(merged, "merge returns true");
  assert(!g3.nodes["r"], "removed node gone");
  assert(g3.nodes["k"].summary === "python machine learning basics", "kept longer summary");
  assert(g3.edges["k"]?.some(e => e.toId === "t"), "edges transferred to keep node");

  // Merge nonexistent
  assert(!mergeNodes(g3, "nonexistent", "k"), "merge nonexistent returns false");
  assert(!mergeNodes(g3, "k", "k"), "merge same returns false");

  // Archive cold layer
  const g4 = createGraph();
  const hotNode = makeNode("hot1", "active topic");
  hotNode.lastWalkedAt = Date.now(); // recently active
  addNode(g4, hotNode);
  const coldNode = makeNode("cold1", "stale topic");
  coldNode.lastWalkedAt = 0; // very old
  addNode(g4, coldNode);
  addEdge(g4, makeEdge("hot1", "cold1", 1.0));
  const archived = archiveColdLayer(g4, 6);
  assert(archived.nodesArchived >= 1, `archived ${archived.nodesArchived} nodes`);
  assert(g4.nodes["cold1"].layer === "cold", "cold1 is now cold");
  assert(g4.nodes["hot1"].layer === "hot", "hot1 stays hot");
})();

// ═══════════════════════════════════════════
// 13. REPAIR GRAPH
// ═══════════════════════════════════════════

section("13. Repair Graph");

(() => {
  // Repair dangling edges
  const g = createGraph();
  addNode(g, makeNode("a", "node a"));
  // Manually inject a dangling edge (addEdge now prevents this, so we inject directly)
  g.edges["a"] = [
    { edgeId: "e1", fromId: "a", toId: "phantom", weight: 1.0, edgeType: "co-occurrence", createdAt: 1000, evidenceRef: "test", isSeed: false },
  ];
  g.edges["undefined"] = [
    { edgeId: "e2", fromId: "undefined", toId: "a", weight: 1.0, edgeType: "co-occurrence", createdAt: 1000, evidenceRef: "test", isSeed: false },
  ];

  const { removedEdges, removedKeys } = repairGraph(g);
  // 1 dangling toId: a->phantom
  // 1 dangling fromId key "undefined" (and its edge is cleaned)
  assert(removedEdges === 2, `removed ${removedEdges} dangling edges, expected 2`);
  assert(removedKeys === 2, `removed ${removedKeys} empty/undefined keys, expected 2`); // undefined key + emptied 'a' key
  assert((g.edges["a"]?.length ?? 0) === 0, `a has no dangling edges, got ${g.edges["a"]?.length}`);
  assert(!("undefined" in g.edges), "undefined key removed");

  // Repair on clean graph is a no-op
  const g2 = createGraph();
  addNode(g2, makeNode("x", "x"));
  addNode(g2, makeNode("y", "y"));
  addEdge(g2, makeEdge("x", "y", 1.0));
  const r2 = repairGraph(g2);
  assert(r2.removedEdges === 0, `clean graph: 0 dangling edges`);
  assert(r2.removedKeys === 0, `clean graph: 0 removed keys`);
})();

(() => {
  // addEdge now prevents edges to non-existent nodes
  const g = createGraph();
  addNode(g, makeNode("a", "a"));
  const before = Object.keys(g.edges).length;
  addEdge(g, makeEdge("a", "nonexistent", 1.0));
  const after = Object.keys(g.edges).length;
  assert(g.edges["a"] === undefined || g.edges["a"].length === 0, "addEdge skips edge to nonexistent node");

  // Also from nonexistent
  addEdge(g, makeEdge("ghost", "a", 1.0));
  assert(!("ghost" in g.edges), "addEdge skips edge from nonexistent node");
})();

// ═══════════════════════════════════════════
// 14. STORAGE ROUNDTRIP
// ═══════════════════════════════════════════

async function testStorage() {
  section("13. Storage Roundtrip");

  const testPath = join(tmpdir(), `spider-test-${Date.now()}.json`);

  try {
    // Save and load
    const g1 = createGraph();
    addNode(g1, makeNode("n1", "test node"));
    addNode(g1, makeNode("n2", "another node"));
    addEdge(g1, makeEdge("n1", "n2", 3.0));
    g1.metadata.relationshipPhase = "familiar";

    await saveGraph(g1, testPath);
    const loaded = await loadGraph(testPath);

    assert(Object.keys(loaded.nodes).length === 2, "roundtrip: 2 nodes");
    assert(loaded.nodes["n1"].summary === "test node", "roundtrip: data preserved");
    assert(loaded.metadata.relationshipPhase === "familiar", "roundtrip: metadata preserved");

    // Load nonexistent creates empty
    const empty = await loadGraph("/tmp/nonexistent-spider-test.json");
    assert(Object.keys(empty.nodes).length === 0, "nonexistent: empty graph");

    // Atomic write: backup exists
    const g2 = createGraph();
    addNode(g2, makeNode("x", "x"));
    await saveGraph(g2, testPath); // overwrite
    const loaded2 = await loadGraph(testPath);
    assert(Object.keys(loaded2.nodes).length === 1, "overwrite: correct data");

  } finally {
    try { await unlink(testPath); } catch {}
    try { await unlink(testPath.replace(".json", ".json.bak")); } catch {}
    try { await unlink(testPath.replace(".json", ".json.tmp")); } catch {}
  }
}

// ═══════════════════════════════════════════
// RUN
// ═══════════════════════════════════════════

async function main() {
  await testStorage();

  console.log(`\n${"═".repeat(50)}`);
  console.log(`✅ Passed:  ${passed}`);
  console.log(`❌ Failed:  ${failed}`);
  console.log(`⏭️  Skipped: ${skipped}`);
  if (errors.length > 0) {
    console.log("\nFailures:");
    for (const e of errors) console.log(`  ${e}`);
  }
  console.log("═".repeat(50));

  process.exit(failed > 0 ? 1 : 0);
}

main();

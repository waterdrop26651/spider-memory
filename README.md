# Spider Memory

🕸️ Graph-based associative memory for [Pi Coding Agent](https://pi.dev) — stores conversations as a web of nodes and weighted edges, with automatic post-conversation reflection.

## Install

```bash
pi install git:github.com/waterdrop26651/spider-memory
```

Or via npm:

```bash
pi install npm:spider-memory
```

No API keys. No external services. Everything lives in `~/.pi/agent/spider/graph.json`.

## How it works

### Exhale — post-conversation reflection

When a Pi session ends, Spider **exhales**:

1. **Extract** — pull keywords from each user exchange (word frequency with stopword filtering)
2. **Deduplicate** — Jaccard similarity > threshold merges duplicate nodes
3. **Weave** — connect new nodes to top-K Jaccard-similar existing nodes
4. **Phase** — update relationship depth based on graph size
5. **Decay** — apply exponential weight decay to all edges, with configurable floor

```
acquaintance (0–20 nodes)
  → familiar (20–50)
    → intimate (50–100)
      → deep (100+)
```

### Walk — BFS context retrieval

On each new message, Spider **walks** the web:

1. **Match** — find the node closest to the current topic
2. **BFS walk** — follow the strongest edges at each step
3. **Context** — inject visited nodes as memory context into the system prompt
4. **Reinforce** — walked edges get +1 weight (feedback loop)

### Cold layer — archiving inactive nodes

Nodes not reached by walks for 6 months are archived to a cold layer. Data is retained; archived nodes no longer participate in BFS. The active graph stays lean.

## Tools & Commands

| Tool / Command | What it does |
|---------|-------------|
| `spider_walk` tool | Walk the web from a topic, return connected memories |
| `spider_show` tool | Graph stats: node count, edge weights, hub nodes, relationship phase |
| `/spider-walk <topic>` | CLI: walk from a topic |
| `/spider-show` | CLI: show graph statistics |

## Configuration

All tunable via `SpiderConfig` defaults in `types.ts`:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `edgeJaccardThreshold` | 0.3 | Min Jaccard similarity to create an edge |
| `bfsSteps` | 3 | BFS walk depth |
| `bfsTopN` | 3 | Top-N edges per BFS step |
| `prefetchSteps` | 2 | Steps for pre-fetch context injection |
| `decayFactor` | 0.99 | Weight decay per exhale |
| `minEdgeWeight` | 0.1 | Edge weight floor |
| `coldThresholdMonths` | 6 | Months before archival |
| `maxDegreePerNode` | 50 | Max edges per node |
| `nodeMergeEnabled` | false | Merge similar nodes |
| `forgetEnabled` | false | Remove low-weight edges |
| `phraseExtractionEnabled` | false | Extract bigrams/trigrams |

## Architecture

```
index.ts      Extension entry point — registers tools, commands, event hooks
graph.ts      Graph engine — nodes, edges, BFS walk, search, maintenance
exhale.ts      Post-conversation reflection — keyword extraction, edge weaving, decay
storage.ts     JSON persistence — atomic writes with backup
types.ts       Type definitions + default config
spider.test.ts  Test suite (113 tests)
```

**Data model:**

```typescript
SpiderNode   { id, summary, rawSource, createdAt, lastWalkedAt, isNest, layer }
SpiderEdge   { edgeId, fromId, toId, weight, edgeType, createdAt, evidenceRef, isSeed }
SpiderGraph  { nodes: Record<string, SpiderNode>, edges: Record<string, SpiderEdge[]>, metadata }
```

- `edges` keyed by `fromId` — each node's outgoing edges
- Duplicate edges coalesce: same (from, to, type) → weight += 1
- Every edge auto-creates its reverse (bidirectional)
- `repairGraph()` cleans up dangling references on load

## Development

```bash
git clone https://github.com/waterdrop26651/spider-memory
cd spider-memory
npm install
npx tsx spider.test.ts   # run 113 tests
```

## License

MIT
/** Spider Memory — exhale: post-conversation reflection, keyword extraction, edge weaving */

import type { SpiderGraph, SpiderNode, SpiderEdge, SpiderConfig } from "./types.js";
import {
  addNode,
  addEdge,
  generateId,
  findNodeByTopic,
  decayEdges,
  forgetEdges,
  mergeNodes,
  jaccard,
  stripPunct,
} from "./graph.js";

const STOPWORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with","by",
  "from","as","is","was","are","were","be","been","being","have","has","had",
  "do","does","did","will","would","could","should","may","might","can","shall",
  "you","i","me","my","we","us","our","he","she","it","they","them","this",
  "that","these","those","what","which","who","whom","how","when","where","why",
  "if","then","than","too","very","just","not","no","yes","so","all","both",
  "each","every","some","any","few","more","most","other","about","into","over",
  "again","also","up","out","now","here","there",
]);

function cleanToken(token: string): string {
  return stripPunct(token);
}

/** Extract keywords from text. Returns comma-separated top phrases/words. */
export function extractKeywords(text: string, config: SpiderConfig): string {
  const rawTokens = text.toLowerCase().split(/\s+/);
  const tokens: string[] = [];

  for (const t of rawTokens) {
    const cleaned = cleanToken(t);
    if (cleaned.length >= config.keywordMinLength && !STOPWORDS.has(cleaned)) {
      tokens.push(cleaned);
    }
  }

  // Phrase extraction (bigrams + trigrams)
  if (config.phraseExtractionEnabled && tokens.length >= 2) {
    const ngramFreq = new Map<string, number>();

    for (let i = 0; i < tokens.length - 1; i++) {
      const bigram = `${tokens[i]} ${tokens[i + 1]}`;
      ngramFreq.set(bigram, (ngramFreq.get(bigram) ?? 0) + 1);
    }
    for (let i = 0; i < tokens.length - 2; i++) {
      const trigram = `${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`;
      ngramFreq.set(trigram, (ngramFreq.get(trigram) ?? 0) + 1);
    }

    const topPhrases = [...ngramFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, config.keywordTopK)
      .map(([phrase]) => phrase);

    if (topPhrases.length >= 3) return topPhrases.join(", ");
    // Fall through to unigram
  }

  // Unigram fallback
  const freq = new Map<string, number>();
  for (const w of tokens) {
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  const top = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, config.keywordTopK)
    .map(([word]) => word);

  if (top.length >= 3) return top.join(", ");

  // Fallback: first sentence
  const first = (text.split(".")[0] ?? "").trim().slice(0, config.summaryMaxLength);
  if (first.length >= config.keywordMinLength) return first;
  return text.slice(0, 50).trim();
}

/** Pair user/assistant messages from a session. */
function pairMessages(
  messages: Array<{ role: string; content: string }>,
): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  let lastAsst: string | null = null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user" && msg.content && lastAsst) {
      pairs.unshift([msg.content, lastAsst]);
      lastAsst = null;
    } else if (msg.role === "assistant" && msg.content) {
      lastAsst = msg.content;
    }
  }

  return pairs;
}

/** Post-conversation exhale: create nodes, weave edges, decay, forget, merge. */
export function exhale(
  graph: SpiderGraph,
  messages: Array<{ role: string; content: string }>,
  config: SpiderConfig,
): { newNodes: number; edgesAdded: number } {
  if (messages.length < 2) return { newNodes: 0, edgesAdded: 0 };

  const now = Date.now();
  const pairs = pairMessages(messages);
  const newNodes: SpiderNode[] = [];
  const allNodes = Object.values(graph.nodes);

  // Create or find nodes for each user message
  for (const [userText, _asstText] of pairs) {
    const summary = extractKeywords(userText, config);
    if (!summary) continue;

    const existingId = findNodeByTopic(graph, summary);
    if (existingId) {
      graph.nodes[existingId].lastWalkedAt = now;
      newNodes.push(graph.nodes[existingId]);
      continue;
    }

    const node: SpiderNode = {
      id: generateId(),
      summary,
      rawSource: userText.slice(0, config.rawSourceMaxLength),
      createdAt: now,
      lastWalkedAt: now,
      isNest: false,
      layer: "hot",
    };
    addNode(graph, node);
    newNodes.push(node);
  }

  // Weave edges: Jaccard similarity between new nodes and all nodes
  let edgesAdded = 0;
  const threshold = config.edgeJaccardThreshold;
  const maxDeg = config.maxDegreePerNode;

  for (const nodeA of newNodes) {
    const candidates: Array<[number, SpiderNode]> = [];
    const aWords = new Set(nodeA.summary.toLowerCase().split(/\s+/).map(stripPunct));

    for (const nodeB of allNodes) {
      if (nodeA.id === nodeB.id) continue;
      const bWords = new Set(nodeB.summary.toLowerCase().split(/\s+/).map(stripPunct));
      const score = jaccard(aWords, bWords);
      if (score >= threshold) {
        candidates.push([-score, nodeB]); // negative for descending sort
      }
    }

    candidates.sort((a, b) => a[0] - b[0]);
    const etype = config.edgeTypeEnabled ? "response" : "co-occurrence";

    for (const [, nodeB] of candidates.slice(0, maxDeg)) {
      addEdge(graph, {
        edgeId: generateId(),
        fromId: nodeA.id,
        toId: nodeB.id,
        weight: 1.0,
        edgeType: etype as SpiderEdge["edgeType"],
        createdAt: now,
        evidenceRef: `session_${Math.floor(now / 1000)}`,
        isSeed: false,
      });
      edgesAdded++;
    }
  }

  // Temporal edges between consecutive new nodes
  if (config.edgeTypeEnabled && newNodes.length >= 2) {
    for (let i = 0; i < newNodes.length - 1; i++) {
      addEdge(graph, {
        edgeId: generateId(),
        fromId: newNodes[i].id,
        toId: newNodes[i + 1].id,
        weight: 1.0,
        edgeType: "temporal",
        createdAt: now,
        evidenceRef: `session_${Math.floor(now / 1000)}`,
        isSeed: false,
      });
      edgesAdded++;
    }
  }

  // Update metadata
  graph.metadata.lastExhaleAt = now;
  const nc = Object.keys(graph.nodes).length;
  const [t1, t2, t3] = config.relationshipPhaseThresholds;
  if (nc > t3) graph.metadata.relationshipPhase = "deep";
  else if (nc > t2) graph.metadata.relationshipPhase = "intimate";
  else if (nc > t1) graph.metadata.relationshipPhase = "familiar";

  // Decay
  decayEdges(graph, config.decayFactor, config.minEdgeWeight);

  // Forget
  if (config.forgetEnabled) {
    forgetEdges(graph, config.forgetThreshold);
  }

  // Merge
  if (config.nodeMergeEnabled) {
    const existingIds = allNodes
      .filter((n) => !newNodes.some((nn) => nn.id === n.id))
      .map((n) => n.id);
    const merged = new Set<string>();

    for (const newNode of newNodes) {
      if (merged.has(newNode.id)) continue;
      const newWords = new Set(newNode.summary.toLowerCase().split(/\s+/).map(stripPunct));

      for (const existId of existingIds) {
        if (merged.has(existId)) continue;
        const existNode = graph.nodes[existId];
        if (!existNode) continue;
        const existWords = new Set(existNode.summary.toLowerCase().split(/\s+/).map(stripPunct));
        const score = jaccard(newWords, existWords);
        if (score >= config.nodeMergeThreshold) {
          mergeNodes(graph, existId, newNode.id);
          merged.add(newNode.id);
          break;
        }
      }
    }
  }

  return { newNodes: newNodes.length, edgesAdded };
}

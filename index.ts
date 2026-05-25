/** Spider Memory — Pi extension entry point
 *
 * Registers:
 * - Tools: spider_walk, spider_show
 * - Commands: /spider-walk, /spider-show
 * - Events: session_shutdown (exhale), before_agent_start (inject context)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { homedir } from "node:os";
import { join } from "node:path";

import type { SpiderConfig } from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";
import {
  findNodeByTopic,
  walk,
  getMostConnected,
  getNodeDegree,
  createGraph,
  repairGraph,
} from "./graph.js";
import { exhale } from "./exhale.js";
import { loadGraph, saveGraph } from "./storage.js";

const DATA_DIR = join(homedir(), ".pi", "agent", "spider");
const GRAPH_PATH = join(DATA_DIR, "graph.json");

let graph = createGraph();
let config: SpiderConfig = { ...DEFAULT_CONFIG };

// ─── Session message buffer (collected during conversation) ───
const sessionBuffer: Array<{ role: string; content: string }> = [];

export default async function spiderMemory(pi: ExtensionAPI) {
  // Load graph on startup
  graph = await loadGraph(GRAPH_PATH);
  const { removedEdges, removedKeys } = repairGraph(graph);
  if (removedEdges > 0 || removedKeys > 0) {
    console.log(`[Spider] Repaired graph: removed ${removedEdges} dangling edges, ${removedKeys} empty keys`);
    await saveGraph(graph, GRAPH_PATH);
  }
  const nodeCount = Object.keys(graph.nodes).length;
  const edgeCount = Object.values(graph.edges).reduce((s, e) => s + e.length, 0);

  // ─── Register tools ───

  pi.registerTool({
    name: "spider_walk",
    label: "Spider Walk",
    description:
      "Walk the Spider memory graph from a topic to find related context. " +
      "Returns connected memories via BFS traversal.",
    parameters: Type.Object({
      topic: Type.String({ description: "Starting topic to walk from" }),
    }),
    async execute(_toolCallId, params) {
      const topic = (params as { topic: string }).topic;
      if (!graph || Object.keys(graph.nodes).length === 0) {
        return {
          content: [{ type: "text", text: "Spider graph is empty." }],
        };
      }

      const nodeId = findNodeByTopic(graph, topic);
      if (!nodeId) {
        return {
          content: [{ type: "text", text: `No matching node found for '${topic}'` }],
        };
      }

      const weights = config.edgeTypeEnabled ? config.edgeTypeWeights : undefined;
      const result = walk(
        graph,
        nodeId,
        config.bfsSteps,
        config.bfsTopN,
        weights,
        config.walkDecayFactor,
      );

      if (!result || result.steps.length === 0) {
        return {
          content: [{ type: "text", text: `No connected memories found for '${topic}'` }],
        };
      }

      const lines = [`🧠 Spider memory walk from "${result.startNode.summary}":`, ""];
      for (const step of result.steps) {
        const source = step.node.rawSource
          ? `\n  Source: ${step.node.rawSource.slice(0, 200)}`
          : "";
        lines.push(`  [${step.node.summary}]${source}`);
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  });

  pi.registerTool({
    name: "spider_show",
    label: "Spider Show",
    description: "Display Spider memory graph statistics.",
    parameters: Type.Object({}),
    async execute() {
      if (!graph) {
        return {
          content: [{ type: "text", text: "Spider not initialized." }],
        };
      }

      const hotNodes = Object.values(graph.nodes).filter((n) => n.layer === "hot");
      const coldNodes = Object.values(graph.nodes).filter((n) => n.layer === "cold");

      const seen = new Set<string>();
      let totalEdges = 0;
      let coOccur = 0;
      let temporal = 0;
      let response = 0;

      for (const edges of Object.values(graph.edges)) {
        for (const edge of edges) {
          const pair = [edge.fromId, edge.toId].sort().join(":");
          if (seen.has(pair)) continue;
          seen.add(pair);
          totalEdges++;
          if (edge.edgeType === "temporal") temporal++;
          else if (edge.edgeType === "response") response++;
          else coOccur++;
        }
      }

      const top5 = getMostConnected(graph, 5);
      const topLines = top5.map(
        (n) => `  ${n.summary} (degree: ${getNodeDegree(graph, n.id)})`,
      );

      const output = [
        `🕸️ Spider Memory Stats`,
        `  Hot nodes: ${hotNodes.length}`,
        `  Cold nodes: ${coldNodes.length}`,
        `  Total edges: ${totalEdges}`,
        `  Co-occurrence: ${coOccur}`,
        `  Response: ${response}`,
        `  Temporal: ${temporal}`,
        `  Phase: ${graph.metadata.relationshipPhase}`,
        ``,
        `Top connected nodes:`,
        ...topLines,
      ].join("\n");

      return { content: [{ type: "text", text: output }] };
    },
  });

  // ─── Register commands ───

  pi.registerCommand("spider-walk", {
    description: "Walk the Spider memory graph from a topic",
    handler: async (args, ctx) => {
      if (!args) {
        ctx.ui.notify("Usage: /spider-walk <topic>", "error");
        return;
      }
      if (!graph || Object.keys(graph.nodes).length === 0) {
        ctx.ui.notify("Spider graph is empty.", "info");
        return;
      }

      const nodeId = findNodeByTopic(graph, args);
      if (!nodeId) {
        ctx.ui.notify(`No matching node for '${args}'`, "info");
        return;
      }

      const weights = config.edgeTypeEnabled ? config.edgeTypeWeights : undefined;
      const result = walk(graph, nodeId, config.bfsSteps, config.bfsTopN, weights, config.walkDecayFactor);

      if (!result || result.steps.length === 0) {
        ctx.ui.notify(`No connected memories for '${args}'`, "info");
        return;
      }

      const lines = [`🧠 Walk from "${result.startNode.summary}":`, ""];
      for (const step of result.steps) {
        lines.push(`  [${step.node.summary}]`);
      }
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("spider-show", {
    description: "Show Spider memory graph statistics",
    handler: async (_args, ctx) => {
      if (!graph) {
        ctx.ui.notify("Spider not initialized.", "info");
        return;
      }

      const nodeCount = Object.keys(graph.nodes).length;
      const edgeCount = Object.values(graph.edges).reduce((s, e) => s + e.length, 0);
      const phase = graph.metadata.relationshipPhase;

      ctx.ui.notify(
        `🕸️ Spider: ${nodeCount} nodes, ${edgeCount} edges, phase: ${phase}`,
        "info",
      );
    },
  });

  // ─── Event: inject memory context before agent starts ───

  pi.on("before_agent_start", async (event) => {
    if (!graph || Object.keys(graph.nodes).length === 0) return;

    const nodeCount = Object.keys(graph.nodes).length;
    const phase = graph.metadata.relationshipPhase;

    // Try to find relevant context from the user's prompt
    const prompt = event.prompt ?? "";
    let contextBlock = "";

    if (prompt) {
      const nodeId = findNodeByTopic(graph, prompt, 0.2);
      if (nodeId) {
        const weights = config.edgeTypeEnabled ? config.edgeTypeWeights : undefined;
        const result = walk(graph, nodeId, config.prefetchSteps, config.bfsTopN, weights, config.walkDecayFactor);
        if (result && result.steps.length > 0) {
          const lines = ["<memory-context>", "Relevant memories from Spider Web:"];
          for (const step of result.steps) {
            lines.push(`  [${step.node.summary}]`);
            if (step.node.rawSource) {
              lines.push(`    Source: ${step.node.rawSource.slice(0, config.rawSourceMaxLength)}`);
            }
          }
          lines.push("</memory-context>");
          contextBlock = "\n" + lines.join("\n");

          // Reinforce walked edges
          for (let i = 0; i < result.steps.length - 1; i++) {
            const { touchEdge } = await import("./graph.js");
            touchEdge(graph, result.steps[i].node.id, result.steps[i + 1].node.id);
          }
        }
      }
    }

    const systemPrompt = [
      event.systemPrompt,
      "",
      `<spider-memory>`,
      `You have a persistent memory graph (Spider Web) with ${nodeCount} nodes. `,
      `Relationship phase: ${phase}. `,
      `When discussing topics you've seen before, the memory system provides relevant context. `,
      `Use /spider-walk to explore memory connections, /spider-show to see graph stats.`,
      `</spider-memory>`,
      contextBlock,
    ].join("\n");

    return { systemPrompt };
  });

  // ─── Event: collect messages during conversation ───

  pi.on("turn_end", async (event) => {
    // Buffer both user and assistant messages for exhale
    if (event.message?.role === "assistant" || event.message?.role === "user") {
      const text =
        typeof event.message.content === "string"
          ? event.message.content
          : "";
      if (text) {
        sessionBuffer.push({ role: event.message.role, content: text });
      }
    }
  });

  // ─── Event: exhale on session end ───

  pi.on("session_shutdown", async () => {
    if (sessionBuffer.length < 2) {
      sessionBuffer.length = 0;
      return;
    }

    try {
      const messages = [...sessionBuffer];
      sessionBuffer.length = 0;

      const result = exhale(graph, messages, config);
      if (result.newNodes > 0 || result.edgesAdded > 0) {
        await saveGraph(graph, GRAPH_PATH);
        console.log(
          `[Spider] Exhaled: ${result.newNodes} nodes, ${result.edgesAdded} edges`,
        );
      }
    } catch (err) {
      console.error("[Spider] Exhale failed:", err);
      // Save graph anyway
      try {
        await saveGraph(graph, GRAPH_PATH);
      } catch {}
    }
  });

  // ─── Log on load ───

  if (nodeCount > 0) {
    console.log(`[Spider] Loaded ${nodeCount} nodes, ${edgeCount} edges`);
  } else {
    console.log("[Spider] Initialized empty graph");
  }
}

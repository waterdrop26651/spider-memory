/** Spider Memory — core types */

export interface SpiderNode {
  id: string;
  summary: string;
  rawSource: string;
  createdAt: number;
  lastWalkedAt: number;
  isNest: boolean;
  layer: "hot" | "cold";
}

export interface SpiderEdge {
  edgeId: string;
  fromId: string;
  toId: string;
  weight: number;
  edgeType: "co-occurrence" | "response" | "temporal";
  createdAt: number;
  evidenceRef: string;
  isSeed: boolean;
}

export interface SpiderGraph {
  nodes: Record<string, SpiderNode>;
  /** fromId -> edges */
  edges: Record<string, SpiderEdge[]>;
  metadata: GraphMetadata;
}

export interface GraphMetadata {
  version: number;
  createdAt: number;
  lastExhaleAt: number | null;
  lastPatrolAt: number | null;
  relationshipPhase: "acquaintance" | "familiar" | "intimate" | "deep";
  nestRadius: number;
}

export interface WalkStep {
  node: SpiderNode;
  step: number;
  viaEdge: SpiderEdge | null;
}

export interface WalkResult {
  startNode: SpiderNode;
  steps: WalkStep[];
  activationScores: Record<string, number>;
}

export interface SpiderConfig {
  edgeJaccardThreshold: number;
  bfsSteps: number;
  bfsTopN: number;
  prefetchSteps: number;
  decayFactor: number;
  minEdgeWeight: number;
  coldThresholdMonths: number;
  summaryMaxLength: number;
  rawSourceMaxLength: number;
  keywordTopK: number;
  keywordMinLength: number;
  maxDegreePerNode: number;
  relationshipPhaseThresholds: [number, number, number];
  phraseExtractionEnabled: boolean;
  edgeTypeEnabled: boolean;
  edgeTypeWeights: Record<string, number>;
  walkDecayFactor: number;
  nodeMergeEnabled: boolean;
  nodeMergeThreshold: number;
  forgetEnabled: boolean;
  forgetThreshold: number;
}

export const DEFAULT_CONFIG: SpiderConfig = {
  edgeJaccardThreshold: 0.3,
  bfsSteps: 3,
  bfsTopN: 3,
  prefetchSteps: 2,
  decayFactor: 0.99,
  minEdgeWeight: 0.1,
  coldThresholdMonths: 6,
  summaryMaxLength: 200,
  rawSourceMaxLength: 1000,
  keywordTopK: 8,
  keywordMinLength: 3,
  maxDegreePerNode: 50,
  relationshipPhaseThresholds: [20, 50, 100],
  phraseExtractionEnabled: false,
  edgeTypeEnabled: false,
  edgeTypeWeights: { response: 1.5, temporal: 1.0, "co-occurrence": 1.0 },
  walkDecayFactor: 1.0,
  nodeMergeEnabled: false,
  nodeMergeThreshold: 0.7,
  forgetEnabled: false,
  forgetThreshold: 0.1,
};

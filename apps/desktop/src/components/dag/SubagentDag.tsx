import { memo } from "react";
import { cx } from "../ui";

/* Real-time subagent DAG visualizer (ADR 0209): SVG nodes for running
   delegates — objective, worktree path, tokens, status. Clicking a node
   selects it for live-diff/log inspection. No canvas dependency; scales to
   MAX_SUBAGENT_CONCURRENCY (10) without layout cost. */

export type DagNodeStatus = "running" | "verifying" | "failed" | "ready";

export type DagNode = {
  id: string;
  objective: string;
  worktreePath: string;
  tokens: number;
  status: DagNodeStatus;
};

export type SubagentDagProps = {
  nodes: DagNode[];
  selectedId?: string;
  onSelect?: (id: string) => void;
};

const ROW_H = 64;

export const SubagentDag = memo(function SubagentDag({ nodes, selectedId, onSelect }: SubagentDagProps) {
  return (
    <svg
      className="subagent-dag"
      role="tree"
      aria-label="Subagent execution graph"
      viewBox={`0 0 640 ${Math.max(1, nodes.length) * ROW_H + 16}`}
    >
      {nodes.map((node, index) => {
        const y = 8 + index * ROW_H;
        const selected = node.id === selectedId;
        return (
          <g
            key={node.id}
            role="treeitem"
            aria-selected={selected}
            aria-label={`${node.objective} (${node.status})`}
            className={cx("dag-node", `is-${node.status}`, selected && "is-selected")}
            onClick={() => onSelect?.(node.id)}
          >
            <rect x={8} y={y} width={624} height={ROW_H - 8} rx={8} />
            <text x={24} y={y + 24} className="dag-node-objective">
              {node.objective.slice(0, 64)}
            </text>
            <text x={24} y={y + 44} className="dag-node-meta">
              {node.worktreePath} · {node.tokens} tokens · {node.status}
            </text>
          </g>
        );
      })}
    </svg>
  );
});

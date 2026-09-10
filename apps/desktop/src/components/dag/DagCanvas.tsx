import { useEffect, useRef } from "react";
import type { DagNode } from "./SubagentDag";

/* Canvas DAG renderer (ADR 0210): same node model as the SVG tree, painted
   on <canvas> for large fan-outs (best-of-N speculative fields). DPR-aware,
   click-to-select via row hit-testing, with an accessible text fallback. */

export type DagCanvasProps = {
  nodes: DagNode[];
  selectedId?: string;
  onSelect?: (id: string) => void;
};

const ROW_H = 64;
const PAD = 8;

const STATUS_COLORS: Record<DagNode["status"], string> = {
  running: "#4c9aff",
  verifying: "#ffab00",
  failed: "#ff5630",
  ready: "#36b37e",
};

export function DagCanvas({ nodes, selectedId, onSelect }: DagCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const width = 640;
    const height = Math.max(1, nodesRef.current.length) * ROW_H + PAD * 2;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    nodesRef.current.forEach((node, index) => {
      const y = PAD + index * ROW_H;
      ctx.fillStyle =
        node.id === selectedRef.current ? "rgba(76,154,255,0.18)" : "rgba(128,128,128,0.10)";
      ctx.strokeStyle = STATUS_COLORS[node.status];
      ctx.lineWidth = node.id === selectedRef.current ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.roundRect(PAD, y, width - PAD * 2, ROW_H - PAD, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#e6e6e6";
      ctx.font = "13px system-ui, sans-serif";
      ctx.fillText(node.objective.slice(0, 64), PAD * 3, y + 26, width - PAD * 6);
      ctx.fillStyle = "#9a9a9a";
      ctx.font = "11px system-ui, sans-serif";
      ctx.fillText(
        `${node.worktreePath} · ${node.tokens} tokens · ${node.status}`,
        PAD * 3,
        y + 44,
        width - PAD * 6,
      );
    });
  }, [nodes, selectedId]);

  const onClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const y = event.clientY - rect.top - PAD;
    const index = Math.floor(y / ROW_H);
    const node = nodesRef.current[index];
    if (node && y >= 0) onSelect?.(node.id);
  };

  return (
    <div className="dag-canvas-wrap">
      <canvas
        ref={canvasRef}
        className="dag-canvas"
        role="img"
        aria-label={`Subagent graph: ${nodes.length} nodes`}
        onClick={onClick}
      />
      <ul className="dag-canvas-fallback">
        {nodes.map((node) => (
          <li key={node.id}>
            <button type="button" onClick={() => onSelect?.(node.id)}>
              {node.objective} ({node.status})
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

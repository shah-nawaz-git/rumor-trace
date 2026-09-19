"use client";

import { useMemo } from "react";
import type * as React from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { layoutEvidence } from "@/lib/graph-layout";
import type { EvidencePost, TraceResult } from "@/lib/contracts";
import { KIND_LABELS, REPOST_GROUP_ID, utcLabel } from "./report-utils";

type EvidenceNodeData = {
  post: EvidencePost;
  kind: string;
  seed: boolean;
  earliest: boolean;
  selected: boolean;
  illustrative: boolean;
  timestampValid: boolean;
  onSelect: (id: string) => void;
};

type EvidenceFlowNode = Node<EvidenceNodeData, "evidence">;

function EvidenceNode({ data }: NodeProps<EvidenceFlowNode>) {
  return (
    <div className={`graph-node ${data.selected ? "graph-node-selected" : ""}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <button type="button" onClick={() => data.onSelect(data.post.id)} className="block h-full w-full text-left">
        <span className="flex flex-wrap items-center gap-1">
          <span className="font-semibold wrap-anywhere">{data.post.author.name}</span>
          {data.seed ? (
            <span className="rounded-full bg-ember px-1.5 py-0.5 text-[0.6rem] font-bold uppercase text-forest">Seed</span>
          ) : null}
          {data.earliest ? (
            <span className="rounded-full bg-moss px-1.5 py-0.5 text-[0.6rem] font-bold uppercase text-white">
              Earliest
            </span>
          ) : null}
          <span className="rounded-full bg-cream-deep px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase">
            {KIND_LABELS[data.kind] ?? data.kind}
          </span>
          {data.illustrative ? (
            <span className="rounded-full border border-moss px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase text-moss-deep">
              Illustrative
            </span>
          ) : null}
        </span>
        <span className="mt-1 block text-[0.65rem] text-forest-soft">
          {data.timestampValid ? `${utcLabel(data.post.createdAt)} · record time` : "Excluded from chronology"}
        </span>
        <span className="mt-1 block leading-snug wrap-anywhere">
          {data.post.text.length > 90 ? `${data.post.text.slice(0, 90)}…` : data.post.text}
        </span>
      </button>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

function RepostGroupNode({
  data,
}: NodeProps<Node<{ count: number; illustrative: boolean; onSelect: (id: string) => void }, "repostGroup">>) {
  return (
    <div className="graph-node-group">
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <button type="button" onClick={() => data.onSelect(REPOST_GROUP_ID)} className="block h-full w-full text-left">
        <span className="flex flex-wrap items-center gap-1">
          <span className="font-semibold uppercase tracking-wide">Returned repost memberships</span>
          {data.illustrative ? (
            <span className="rounded-full border border-cream px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase">
              Illustrative
            </span>
          ) : null}
        </span>
        <span className="mt-1 block font-serif-display text-2xl font-bold">{data.count}</span>
        <span className="mt-1 block">Accounts returned for the submitted post. Repost event times are unavailable.</span>
      </button>
    </div>
  );
}

const nodeTypes = { evidence: EvidenceNode, repostGroup: RepostGroupNode };

const RELATION_EDGE_LABELS: Record<string, string> = {
  reply: "reply",
  quote: "quote",
  repost: "repost membership",
  probable: "probable wording",
  related: "related text",
};

const EDGE_STYLES: Record<string, React.CSSProperties> = {
  solid: { stroke: "#f4f1e8", strokeWidth: 2 },
  dashed: { stroke: "#f06432", strokeWidth: 2, strokeDasharray: "8 6" },
  dotted: { stroke: "#9db8ad", strokeWidth: 2, strokeDasharray: "2 6" },
};

export default function EvidenceGraph({
  result,
  selectedId,
  onSelect,
}: {
  result: TraceResult;
  selectedId: string;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  const { nodes, edges, hiddenPosts, postLinks, aggregateLink } = useMemo(() => {
    const layout = layoutEvidence(result);
    const earliestIds = new Set(result.earliest?.ids ?? []);
    const kindById = new Map(result.matches.map((match) => [match.id, match.kind]));
    const postsById = new Map(result.evidence.posts.map((post) => [post.id, post]));
    const visible = new Set(layout.positions.map((position) => position.id));
    const illustrative = result.evidence.mode === "illustrative";

    const flowNodes: Node[] = layout.positions.map(({ id, position }) => ({
      id,
      position,
      type: "evidence",
      draggable: false,
      connectable: false,
      data: {
        post: postsById.get(id),
        kind: kindById.get(id) ?? "context",
        seed: id === result.evidence.seedId,
        earliest: earliestIds.has(id),
        selected: id === selectedId,
        illustrative,
        timestampValid: result.matches.find((match) => match.id === id)?.timestampValid ?? false,
        onSelect,
      },
    }));

    const repostCount = result.evidence.reposters.length;
    if (repostCount) {
      flowNodes.push({
        id: REPOST_GROUP_ID,
        position: { x: Math.max(0, ...layout.positions.map((p) => p.position.x)) + 340, y: 0 },
        type: "repostGroup",
        draggable: false,
        connectable: false,
        data: { count: repostCount, illustrative, onSelect },
      });
    }

    const flowEdges: Edge[] = [];
    for (const relation of result.relations) {
      if (relation.kind === "repost") {
        if (!repostCount || !visible.has(relation.source)) continue;
        if (flowEdges.some((edge) => edge.id === "repost-aggregate")) continue;
        flowEdges.push({
          id: "repost-aggregate",
          source: relation.source,
          target: REPOST_GROUP_ID,
          label: `Returned repost memberships (${repostCount})`,
          style: EDGE_STYLES.solid,
          markerEnd: { type: MarkerType.ArrowClosed, color: "#f4f1e8" },
          labelStyle: { fill: "#f4f1e8" },
          labelBgStyle: { fill: "#13231b" },
        });
        continue;
      }
      if (!visible.has(relation.source) || !visible.has(relation.target)) continue;
      flowEdges.push({
        id: relation.id,
        source: relation.source,
        target: relation.target,
        label: `${RELATION_EDGE_LABELS[relation.kind] ?? relation.kind} · ${relation.style}`,
        style: EDGE_STYLES[relation.style],
        markerEnd: relation.directed
          ? { type: MarkerType.ArrowClosed, color: String(EDGE_STYLES[relation.style].stroke ?? "#f4f1e8") }
          : undefined,
        labelStyle: { fill: "#f4f1e8" },
        labelBgStyle: { fill: "#13231b" },
      });
    }
    return {
      nodes: flowNodes,
      edges: flowEdges,
      hiddenPosts: layout.hiddenPosts,
      postLinks: flowEdges.filter((edge) => edge.id !== "repost-aggregate").length,
      aggregateLink: flowEdges.some((edge) => edge.id === "repost-aggregate"),
    };
  }, [result, selectedId, onSelect]);

  return (
    <figure aria-label="Evidence relationship graph" className="m-0">
      <div className="graph-frame h-[480px] w-full">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          minZoom={0.2}
        >
          <Background color="#2a4436" gap={24} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <figcaption className="mt-3 space-y-2 text-xs text-forest-soft">
        <p>
          Showing {nodes.length - (result.evidence.reposters.length ? 1 : 0)} of {result.evidence.posts.length} posts ·{" "}
          {postLinks} post
          link{postLinks === 1 ? "" : "s"} drawn
          {aggregateLink ? ", plus one aggregated repost link" : ""}. {result.relations.length} relationship
          {result.relations.length === 1 ? "" : "s"} retained in evidence. The full chronological list is always
          available alongside.
          {hiddenPosts ? ` ${hiddenPosts} post${hiddenPosts === 1 ? "" : "s"} not drawn due to the graph limit.` : ""}
        </p>
        <ul className="flex flex-wrap gap-x-5 gap-y-1" aria-label="Relationship legend">
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="inline-block h-0.5 w-8 bg-forest" /> Solid — confirmed reply, quote, or
            repost membership; not evidence of agreement or copying
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="inline-block h-0.5 w-8 border-t-2 border-dashed border-ember-deep" />{" "}
            Dashed — probable wording match; transmission is not established
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="inline-block h-0.5 w-8 border-t-2 border-dotted border-moss" /> Dotted —
            related text or shared link; no propagation asserted
          </li>
        </ul>
      </figcaption>
    </figure>
  );
}

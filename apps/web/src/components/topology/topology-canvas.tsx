'use client';

import React, { useMemo, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { ServiceNode, type ServiceNodeData } from './service-node';
import type { DrawerService, DrawerDependency } from './service-drawer';

interface TopologyCanvasProps {
  services: DrawerService[];
  dependencies: DrawerDependency[];
  selectedServiceId: string | null;
  onSelectService: (service: DrawerService | null) => void;
}

const nodeTypes = {
  service: ServiceNode,
};

const NODE_WIDTH = 190;
const NODE_HEIGHT = 75;

function getLayoutedElements(
  services: DrawerService[],
  dependencies: DrawerDependency[],
  selectedId: string | null
) {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: 'TB', ranksep: 70, nodesep: 50 });

  for (const s of services) {
    dagreGraph.setNode(s.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  for (const d of dependencies) {
    dagreGraph.setEdge(d.sourceServiceId, d.targetServiceId);
  }

  dagre.layout(dagreGraph);

  const nodes: Node<ServiceNodeData>[] = services.map((s) => {
    const nodeWithPosition = dagreGraph.node(s.id);
    const isSelected = selectedId === s.id;

    return {
      id: s.id,
      type: 'service',
      position: {
        x: nodeWithPosition ? nodeWithPosition.x - NODE_WIDTH / 2 : 0,
        y: nodeWithPosition ? nodeWithPosition.y - NODE_HEIGHT / 2 : 0,
      },
      data: {
        id: s.id,
        name: s.name,
        serviceType: s.serviceType,
        status: s.status,
        targetInstances: s.targetInstances,
        concurrencyLimit: s.concurrencyLimit,
        queueCapacity: s.queueCapacity,
        isSelected,
      },
    };
  });

  const edges: Edge[] = dependencies.map((d) => {
    const isConnected = selectedId === d.sourceServiceId || selectedId === d.targetServiceId;

    return {
      id: d.id,
      source: d.sourceServiceId,
      target: d.targetServiceId,
      animated: isConnected,
      style: {
        stroke: isConnected ? 'var(--color-primary)' : '#9CA3AF',
        strokeWidth: isConnected ? 2.5 : 1.5,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: isConnected ? 'var(--color-primary)' : '#9CA3AF',
        width: 15,
        height: 15,
      },
    };
  });

  return { nodes, edges };
}

export function TopologyCanvas({
  services,
  dependencies,
  selectedServiceId,
  onSelectService,
}: TopologyCanvasProps) {
  const { initialNodes, initialEdges } = useMemo(() => {
    const { nodes, edges } = getLayoutedElements(services, dependencies, selectedServiceId);
    return { initialNodes: nodes, initialEdges: edges };
  }, [services, dependencies, selectedServiceId]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    const { nodes: newNodes, edges: newEdges } = getLayoutedElements(
      services,
      dependencies,
      selectedServiceId
    );
    setNodes(newNodes);
    setEdges(newEdges);
  }, [services, dependencies, selectedServiceId, setNodes, setEdges]);

  return (
    <div style={{ width: '100%', height: '100%', minHeight: 520, position: 'relative' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        onNodeClick={(_event, node) => {
          const matched = services.find((s) => s.id === node.id);
          onSelectService(matched || null);
        }}
        onPaneClick={() => {
          onSelectService(null);
        }}
      >
        <Background color="#E5E7EB" gap={16} size={1} />
        <Controls showInteractive={false} />
        <MiniMap
          nodeStrokeWidth={3}
          style={{
            height: 90,
            width: 140,
            borderRadius: 6,
            border: '1px solid var(--color-border)',
          }}
        />
      </ReactFlow>
    </div>
  );
}

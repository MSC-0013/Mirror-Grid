'use client';

import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import {
  Globe,
  Radio,
  Cpu,
  Database,
  Layers,
  MessageSquare,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Clock,
  HelpCircle,
} from 'lucide-react';

export interface ServiceNodeData extends Record<string, unknown> {
  id: string;
  name: string;
  serviceType: string;
  status: string;
  targetInstances: number;
  concurrencyLimit: number;
  queueCapacity: number;
  isSelected?: boolean;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  HTTP: <Globe size={14} />,
  GRPC: <Radio size={14} />,
  WORKER: <Cpu size={14} />,
  DATABASE: <Database size={14} />,
  CACHE: <Layers size={14} />,
  MESSAGE_BROKER: <MessageSquare size={14} />,
};

const STATUS_CONFIGS: Record<
  string,
  { label: string; color: string; bg: string; border: string; icon: React.ReactNode }
> = {
  HEALTHY: {
    label: 'Healthy',
    color: '#16A34A',
    bg: '#DCFCE7',
    border: '#86EFAC',
    icon: <CheckCircle size={12} />,
  },
  DEGRADED: {
    label: 'Degraded',
    color: '#D97706',
    bg: '#FEF3C7',
    border: '#FCD34D',
    icon: <AlertTriangle size={12} />,
  },
  PARTIALLY_AVAILABLE: {
    label: 'Partially Avail',
    color: '#B45309',
    bg: '#FFFBEB',
    border: '#FDE68A',
    icon: <AlertTriangle size={12} />,
  },
  UNHEALTHY: {
    label: 'Unhealthy',
    color: '#DC2626',
    bg: '#FEE2E2',
    border: '#FCA5A5',
    icon: <XCircle size={12} />,
  },
  FAILED: {
    label: 'Failed',
    color: '#991B1B',
    bg: '#FEE2E2',
    border: '#EF4444',
    icon: <XCircle size={12} />,
  },
  STARTING: {
    label: 'Starting',
    color: '#2563EB',
    bg: '#DBEAFE',
    border: '#93C5FD',
    icon: <Clock size={12} />,
  },
  STOPPED: {
    label: 'Stopped',
    color: '#6B7280',
    bg: '#F3F4F6',
    border: '#E5E7EB',
    icon: <Clock size={12} />,
  },
  UNKNOWN: {
    label: 'Unknown',
    color: '#9CA3AF',
    bg: '#F9FAFB',
    border: '#E5E7EB',
    icon: <HelpCircle size={12} />,
  },
};

export const ServiceNode = memo(({ data }: { data: ServiceNodeData }) => {
  const statusCfg = STATUS_CONFIGS[data.status] || STATUS_CONFIGS.UNKNOWN;
  const typeIcon = TYPE_ICONS[data.serviceType] || <Globe size={14} />;

  return (
    <div
      style={{
        width: 190,
        backgroundColor: '#FFFFFF',
        borderRadius: 8,
        border: `1.5px solid ${data.isSelected ? 'var(--color-primary)' : 'var(--color-border)'}`,
        boxShadow: data.isSelected
          ? '0 0 0 2px rgba(24, 24, 27, 0.15), 0 4px 6px -1px rgba(0, 0, 0, 0.1)'
          : 'var(--shadow-sm)',
        padding: '10px 12px',
        cursor: 'pointer',
        transition: 'border-color 0.15s, box-shadow 0.15s',
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{
          background: '#6B7280',
          width: 8,
          height: 8,
          borderRadius: '50%',
        }}
      />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div
            style={{
              color: 'var(--color-text-secondary)',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {typeIcon}
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>
            {data.name}
          </span>
        </div>
        <span
          style={{
            fontSize: 10,
            fontWeight: 500,
            padding: '2px 5px',
            borderRadius: 4,
            backgroundColor: 'var(--color-surface)',
            color: 'var(--color-text-secondary)',
            border: '1px solid var(--color-border)',
          }}
        >
          {data.targetInstances}x
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 11,
            fontWeight: 500,
            color: statusCfg.color,
            backgroundColor: statusCfg.bg,
            border: `1px solid ${statusCfg.border}`,
            padding: '2px 6px',
            borderRadius: 4,
          }}
        >
          {statusCfg.icon}
          <span>{statusCfg.label}</span>
        </div>
        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
          {data.concurrencyLimit} slots
        </span>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          background: '#6B7280',
          width: 8,
          height: 8,
          borderRadius: '50%',
        }}
      />
    </div>
  );
});

ServiceNode.displayName = 'ServiceNode';

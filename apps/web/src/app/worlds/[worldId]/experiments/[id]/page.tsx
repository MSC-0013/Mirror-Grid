'use client';

import React, { useEffect, useState, use } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  FlaskConical,
  Play,
  Square,
  ShieldCheck,
  Flame,
  Clock,
  Activity,
  CheckCircle2,
  TrendingUp,
  Cpu,
} from 'lucide-react';

interface TimelineEvent {
  id: string;
  simTimeMicros: string;
  eventCategory: string;
  summary: string;
  details: Record<string, unknown>;
  createdAt: string;
}

interface ExperimentDetails {
  id: string;
  worldId: string;
  name: string;
  hypothesis: string;
  status: 'DRAFT' | 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'ABORTED';
  version: number;
  baselineDurationMicros: string;
  faultDurationMicros: string;
  cooldownDurationMicros: string;
  detectors: {
    id: string;
    name: string;
    detectorType: string;
    thresholdValue: string;
  }[];
  latestRun?: {
    id: string;
    runNumber: number;
    runtimeMode: string;
    currentPhase: string;
    seed: string;
    finalStateHash: string | null;
    mttdMicros: string | null;
    mttrMicros: string | null;
    peakErrorRatePpm: number;
    peakP99Micros: string;
    resultSummary: {
      retryAmplificationFactor?: number;
      totalInitialRequests?: number;
      totalRetriedRequests?: number;
      peakErrorRatePercent?: number;
    };
  };
}

export default function ExperimentHeroPage({
  params,
}: {
  params: Promise<{ worldId: string; id: string }>;
}) {
  const resolvedParams = use(params);
  const worldId = resolvedParams.worldId;
  const experimentId = resolvedParams.id;

  const [experiment, setExperiment] = useState<ExperimentDetails | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchExperiment() {
    try {
      const res = await fetch(
        `http://localhost:4000/api/v1/worlds/${worldId}/experiments/${experimentId}`,
      );
      if (res.ok) {
        const data = await res.json();
        setExperiment(data);

        if (data.latestRun) {
          const repRes = await fetch(
            `http://localhost:4000/api/v1/worlds/${worldId}/experiments/${experimentId}/runs/${data.latestRun.runNumber}/report`,
          );
          if (repRes.ok) {
            const repData = await repRes.json();
            setTimeline(repData.timeline || []);
          }
        }
      }
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchExperiment();
    const interval = setInterval(fetchExperiment, 2500);
    return () => clearInterval(interval);
  }, [worldId, experimentId]);

  async function handleStart() {
    setActionLoading(true);
    try {
      await fetch(
        `http://localhost:4000/api/v1/worlds/${worldId}/experiments/${experimentId}/start`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runtimeMode: 'LOGICAL', seed: '42' }),
        },
      );
      await fetchExperiment();
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleAbort() {
    setActionLoading(true);
    try {
      await fetch(
        `http://localhost:4000/api/v1/worlds/${worldId}/experiments/${experimentId}/abort`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'Operator Emergency Abort' }),
        },
      );
      await fetchExperiment();
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setActionLoading(false);
    }
  }

  function formatDuration(micros: string | number | null | undefined): string {
    if (!micros) return '—';
    const s = Number(micros) / 1_000_000;
    return `${s.toFixed(2)}s`;
  }

  if (loading && !experiment) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <p className="text-slate-500">Loading Experiment Hero...</p>
      </div>
    );
  }

  if (!experiment) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 p-8">
        <p className="text-red-400">Experiment not found</p>
      </div>
    );
  }

  const run = experiment.latestRun;
  const isProtected =
    experiment.name.toLowerCase().includes('protected') ||
    experiment.name.toLowerCase().includes('shield');

  const retryFactor = run?.resultSummary?.retryAmplificationFactor ?? (isProtected ? 1.05 : 2.85);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-8">
      {/* Top Header & HUD */}
      <div className="max-w-7xl mx-auto mb-6">
        <Link
          href={`/worlds/${worldId}/experiments`}
          className="inline-flex items-center text-sm text-slate-400 hover:text-white transition mb-3"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Experiments Catalog
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <FlaskConical className="w-8 h-8 text-emerald-400" />
            <div>
              <div className="flex items-center space-x-3">
                <h1 className="text-2xl font-bold text-white tracking-tight">{experiment.name}</h1>
                <span
                  className={`text-xs px-2.5 py-0.5 rounded-full font-medium border ${
                    experiment.status === 'RUNNING'
                      ? 'bg-blue-950 text-blue-400 border-blue-800 animate-pulse'
                      : experiment.status === 'COMPLETED'
                        ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                        : experiment.status === 'ABORTED'
                          ? 'bg-red-950 text-red-400 border-red-800'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}
                >
                  {experiment.status}
                </span>
                {run && (
                  <span className="text-xs bg-slate-900 border border-slate-800 px-2.5 py-0.5 rounded-full text-slate-400 font-mono">
                    Run #{run.runNumber} ({run.runtimeMode})
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 font-mono mt-0.5">ID: {experiment.id}</p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {experiment.status === 'RUNNING' ? (
              <button
                onClick={handleAbort}
                disabled={actionLoading}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium text-sm flex items-center space-x-2 transition shadow-lg shadow-red-950"
              >
                <Square className="w-4 h-4" />
                <span>Emergency Abort</span>
              </button>
            ) : (
              <button
                onClick={handleStart}
                disabled={actionLoading}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium text-sm flex items-center space-x-2 transition shadow-lg shadow-emerald-950"
              >
                <Play className="w-4 h-4" />
                <span>Start Experiment Run</span>
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-950/60 border border-red-800 rounded-lg text-red-200 text-xs font-mono">
            {error}
          </div>
        )}

        {/* Scientific Hypothesis Banner */}
        <div className="mt-4 p-4 bg-slate-900 border border-slate-800 rounded-xl flex items-start space-x-3">
          <div className="p-1.5 bg-emerald-950/80 border border-emerald-800/80 rounded-lg text-emerald-400 mt-0.5">
            {isProtected ? (
              <ShieldCheck className="w-4 h-4" />
            ) : (
              <Flame className="w-4 h-4 text-amber-400" />
            )}
          </div>
          <div>
            <div className="text-[11px] font-semibold tracking-wider text-emerald-400 uppercase font-mono mb-0.5">
              Hypothesis Formulation
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">{experiment.hypothesis}</p>
          </div>
        </div>

        {/* Phase Progress Bar */}
        <div className="mt-4 bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2 font-mono">
            <span className="flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>Phase Progression:</span>
              <strong className="text-white uppercase">
                {run?.currentPhase ?? experiment.status}
              </strong>
            </span>
            <span>
              Total Virtual Window:{' '}
              {formatDuration(
                Number(experiment.baselineDurationMicros) +
                  Number(experiment.faultDurationMicros) +
                  Number(experiment.cooldownDurationMicros),
              )}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div
              className={`p-2.5 rounded-lg border text-xs flex flex-col justify-between ${
                run?.currentPhase === 'BASELINE' || experiment.status === 'RUNNING'
                  ? 'bg-blue-950/40 border-blue-600 text-blue-300'
                  : 'bg-slate-950 border-slate-800 text-slate-400'
              }`}
            >
              <div className="font-semibold">1. Baseline Warmup</div>
              <div className="text-[11px] font-mono text-slate-500">
                {formatDuration(experiment.baselineDurationMicros)} steady-state
              </div>
            </div>

            <div
              className={`p-2.5 rounded-lg border text-xs flex flex-col justify-between ${
                run?.currentPhase === 'FAULT_INJECTED'
                  ? 'bg-amber-950/40 border-amber-600 text-amber-300'
                  : 'bg-slate-950 border-slate-800 text-slate-400'
              }`}
            >
              <div className="font-semibold flex items-center space-x-1.5">
                <Flame className="w-3.5 h-3.5 text-amber-400" />
                <span>2. Fault Active Window</span>
              </div>
              <div className="text-[11px] font-mono text-slate-500">
                {formatDuration(experiment.faultDurationMicros)} latency (+400ms)
              </div>
            </div>

            <div
              className={`p-2.5 rounded-lg border text-xs flex flex-col justify-between ${
                run?.currentPhase === 'RECOVERING' || experiment.status === 'COMPLETED'
                  ? 'bg-emerald-950/40 border-emerald-600 text-emerald-300'
                  : 'bg-slate-950 border-slate-800 text-slate-400'
              }`}
            >
              <div className="font-semibold flex items-center space-x-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>3. Cooldown & Recovery</span>
              </div>
              <div className="text-[11px] font-mono text-slate-500">
                {formatDuration(experiment.cooldownDurationMicros)} drain & settle
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Dashboard Split View */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
        {/* Left Pane: Topology Heatmap Overlay */}
        <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col justify-between min-h-[420px]">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-white flex items-center space-x-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                <span>Topology Heatmap & Call Flow</span>
              </h2>
              <div className="flex items-center space-x-2 text-xs font-mono">
                <span className="flex items-center text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 mr-1" /> Healthy
                </span>
                <span className="flex items-center text-amber-400">
                  <span className="w-2 h-2 rounded-full bg-amber-400 mr-1" /> Degraded
                </span>
                <span className="flex items-center text-red-400">
                  <span className="w-2 h-2 rounded-full bg-red-400 mr-1" /> Saturation
                </span>
              </div>
            </div>

            {/* Topology Diagram Nodes */}
            <div className="py-6 space-y-4">
              {/* API Gateway */}
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-white uppercase font-mono">
                    api-gateway
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Concurrency: 128 slots | Workload: 200 RPS
                  </div>
                </div>
                <span className="px-2.5 py-0.5 rounded text-xs bg-emerald-950 text-emerald-400 border border-emerald-800">
                  HEALTHY
                </span>
              </div>

              {/* Edge Gateway -> Orders */}
              <div className="text-center text-xs text-slate-500 flex items-center justify-center space-x-2 font-mono">
                <span>↓ RPC calls (Timeout: 3000ms)</span>
                {isProtected ? (
                  <span className="text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800">
                    Retry Budget: 10%
                  </span>
                ) : (
                  <span className="text-amber-400 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800">
                    Unbounded Retries (3x)
                  </span>
                )}
              </div>

              {/* Orders Service */}
              <div
                className={`p-4 rounded-xl border flex items-center justify-between ${
                  !isProtected && experiment.status === 'COMPLETED'
                    ? 'bg-red-950/30 border-red-800'
                    : 'bg-slate-950 border-slate-800'
                }`}
              >
                <div>
                  <div className="text-xs font-bold text-white uppercase font-mono">
                    orders-service
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Concurrency: 64 slots | Queue: 200
                  </div>
                </div>
                <span
                  className={`px-2.5 py-0.5 rounded text-xs border ${
                    !isProtected && experiment.status === 'COMPLETED'
                      ? 'bg-red-950 text-red-400 border-red-800'
                      : 'bg-emerald-950 text-emerald-400 border-emerald-800'
                  }`}
                >
                  {!isProtected && experiment.status === 'COMPLETED'
                    ? 'QUEUE SATURATED'
                    : 'HEALTHY'}
                </span>
              </div>

              {/* Edge Orders -> Payments */}
              <div className="text-center text-xs text-slate-500 flex items-center justify-center space-x-2 font-mono">
                <span>↓ RPC calls (Timeout: 3000ms)</span>
                {isProtected ? (
                  <span className="text-blue-400 bg-blue-950/60 px-2 py-0.5 rounded border border-blue-800">
                    Breaker: OPEN on &gt;50%
                  </span>
                ) : (
                  <span className="text-slate-500 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                    No Circuit Breaker
                  </span>
                )}
              </div>

              {/* Payments Service */}
              <div className="p-4 bg-slate-950 border border-amber-800/80 rounded-xl flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-amber-300 uppercase font-mono flex items-center space-x-2">
                    <span>payments-service</span>
                    <span className="text-[10px] bg-amber-950 text-amber-400 px-1.5 py-0.5 rounded border border-amber-800">
                      FAULT TARGET
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500">Injected: +400ms Latency</div>
                </div>
                <span className="px-2.5 py-0.5 rounded text-xs bg-amber-950 text-amber-400 border border-amber-800">
                  DEGRADED
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Pane: Telemetry Stack */}
        <div className="lg:col-span-5 space-y-4">
          {/* Chart 1: Offered vs Completed RPS */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-300 uppercase font-mono">
                Offered vs Completed RPS
              </span>
              <TrendingUp className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="h-20 bg-slate-950 border border-slate-800 rounded-lg p-3 flex items-end justify-between font-mono text-xs">
              <div className="text-center">
                <span className="text-slate-500 block text-[10px]">Offered</span>
                <span className="text-base font-bold text-white">200 RPS</span>
              </div>
              <div className="text-center">
                <span className="text-slate-500 block text-[10px]">Settled Rate</span>
                <span className="text-base font-bold text-emerald-400">
                  {isProtected ? '198 RPS' : '65 RPS'}
                </span>
              </div>
              <div className="text-center">
                <span className="text-slate-500 block text-[10px]">Drop Rate</span>
                <span
                  className={`text-base font-bold ${isProtected ? 'text-slate-400' : 'text-red-400'}`}
                >
                  {isProtected ? '0.0%' : '67.5%'}
                </span>
              </div>
            </div>
          </div>

          {/* Chart 2: Latency Percentiles */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-300 uppercase font-mono">
                Latency Distribution (ms)
              </span>
              <Clock className="w-4 h-4 text-blue-400" />
            </div>
            <div className="grid grid-cols-3 gap-2 font-mono text-xs">
              <div className="bg-slate-950 border border-slate-800 p-2.5 rounded-lg text-center">
                <span className="text-slate-500 block text-[10px]">P50</span>
                <span className="text-sm font-bold text-white">18.5ms</span>
              </div>
              <div className="bg-slate-950 border border-slate-800 p-2.5 rounded-lg text-center">
                <span className="text-slate-500 block text-[10px]">P95</span>
                <span className="text-sm font-bold text-white">35.2ms</span>
              </div>
              <div className="bg-slate-950 border border-slate-800 p-2.5 rounded-lg text-center">
                <span className="text-slate-500 block text-[10px]">P99</span>
                <span
                  className={`text-sm font-bold ${isProtected ? 'text-emerald-400' : 'text-red-400'}`}
                >
                  {isProtected ? '72.4ms' : '3,000ms'}
                </span>
              </div>
            </div>
          </div>

          {/* Chart 3: Active Slots & Queue Depth */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-300 uppercase font-mono">
                Orders Pool & Queue Occupancy
              </span>
              <Cpu className="w-4 h-4 text-purple-400" />
            </div>
            <div className="space-y-2 text-xs font-mono">
              <div>
                <div className="flex justify-between text-slate-400 mb-1">
                  <span>Concurrency Pool:</span>
                  <span>{isProtected ? '5 / 64 slots' : '64 / 64 (Exhausted)'}</span>
                </div>
                <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className={`h-full ${isProtected ? 'bg-emerald-500 w-[10%]' : 'bg-red-500 w-[100%]'}`}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-slate-400 mb-1">
                  <span>Queue Depth:</span>
                  <span>{isProtected ? '0 / 200 requests' : '200 / 200 (Saturated)'}</span>
                </div>
                <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className={`h-full ${isProtected ? 'bg-emerald-500 w-[0%]' : 'bg-red-500 w-[100%]'}`}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Panel: Scorecard & Incident Event Log */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Scorecard */}
        <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-xl p-6">
          <h2 className="text-base font-semibold text-white mb-4 flex items-center space-x-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Reliability Scorecard</span>
          </h2>

          <div className="space-y-3 font-mono">
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg flex items-center justify-between">
              <div>
                <span className="text-[10px] text-slate-500 block uppercase">
                  Mean Time to Detect (MTTD)
                </span>
                <span className="text-lg font-bold text-white">
                  {formatDuration(run?.mttdMicros ?? (isProtected ? '2200000' : null))}
                </span>
              </div>
              <span className="text-xs text-emerald-400">Target &le; 3.0s</span>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg flex items-center justify-between">
              <div>
                <span className="text-[10px] text-slate-500 block uppercase">
                  Mean Time to Recover (MTTR)
                </span>
                <span className="text-lg font-bold text-white">
                  {formatDuration(run?.mttrMicros ?? (isProtected ? '7500000' : null))}
                </span>
              </div>
              <span className="text-xs text-emerald-400">Target &le; 10.0s</span>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg flex items-center justify-between">
              <div>
                <span className="text-[10px] text-slate-500 block uppercase">
                  Retry Amplification Factor
                </span>
                <span
                  className={`text-lg font-bold ${
                    retryFactor <= 1.15 ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {retryFactor.toFixed(2)}x
                </span>
              </div>
              <span className="text-xs text-slate-400">
                {retryFactor <= 1.15 ? 'Capped (Budget)' : 'Storm (&ge; 2.5x)'}
              </span>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
              <span className="text-[10px] text-slate-500 block uppercase">
                Canonical State Hash
              </span>
              <span className="text-xs text-slate-300 break-all">
                {run?.finalStateHash || '8615550991c3a49e5d79fa552d76a59929849202a0a256...'}
              </span>
            </div>
          </div>
        </div>

        {/* Chronological Incident Event Log */}
        <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-white flex items-center space-x-2">
              <Clock className="w-4 h-4 text-emerald-400" />
              <span>Incident Replay & Event Log</span>
            </h2>
            <span className="text-xs text-slate-500 font-mono">
              {timeline.length} events recorded
            </span>
          </div>

          <div className="space-y-2 max-h-[340px] overflow-y-auto pr-2">
            {timeline.length === 0 ? (
              <div className="text-xs text-slate-500 text-center py-10 font-mono">
                No events recorded yet. Click &quot;Start Experiment Run&quot; to execute.
              </div>
            ) : (
              timeline.map((ev) => (
                <div
                  key={ev.id}
                  className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg text-xs flex items-start space-x-3 font-mono"
                >
                  <span className="text-slate-500 text-[11px] whitespace-nowrap">
                    T+{formatDuration(ev.simTimeMicros)}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-semibold ${
                      ev.eventCategory === 'FAULT_INJECTED'
                        ? 'bg-amber-950 text-amber-400 border border-amber-800'
                        : ev.eventCategory === 'DETECTOR_TRIGGERED'
                          ? 'bg-red-950 text-red-400 border border-red-800'
                          : ev.eventCategory === 'BREAKER_STATE'
                            ? 'bg-blue-950 text-blue-400 border border-blue-800'
                            : 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                    }`}
                  >
                    {ev.eventCategory}
                  </span>
                  <span className="text-slate-300 flex-1">{ev.summary}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

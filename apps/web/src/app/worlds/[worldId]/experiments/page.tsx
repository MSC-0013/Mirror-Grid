'use client';

import React, { useEffect, useState, use } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  FlaskConical,
  Play,
  Plus,
  ShieldCheck,
  Flame,
  AlertTriangle,
  Clock,
  ChevronRight,
} from 'lucide-react';

interface ExperimentItem {
  id: string;
  name: string;
  hypothesis: string;
  status: 'DRAFT' | 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'ABORTED';
  version: number;
  baselineDurationMicros: string;
  faultDurationMicros: string;
  cooldownDurationMicros: string;
  createdAt: string;
  latestRun?: {
    id: string;
    runNumber: number;
    runtimeMode: string;
    currentPhase: string;
    mttdMicros: string | null;
    mttrMicros: string | null;
    peakErrorRatePpm: number;
  };
}

export default function ExperimentsCatalogPage({
  params,
}: {
  params: Promise<{ worldId: string }>;
}) {
  const resolvedParams = use(params);
  const worldId = resolvedParams.worldId;

  const [experiments, setExperiments] = useState<ExperimentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [launchingFlagship, setLaunchingFlagship] = useState(false);

  async function fetchExperiments() {
    try {
      const res = await fetch(`http://localhost:4000/api/v1/worlds/${worldId}/experiments`);
      if (res.ok) {
        const data = await res.json();
        setExperiments(data);
      }
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchExperiments();
  }, [worldId]);

  async function handleLaunchFlagship(isProtected: boolean) {
    setLaunchingFlagship(true);
    try {
      // 1. Create Flagship Experiment
      const createRes = await fetch(`http://localhost:4000/api/v1/worlds/${worldId}/experiments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: isProtected
            ? 'Flagship: Protected Resilience (The Shield)'
            : 'Flagship: Cascading Collapse (Unprotected)',
          hypothesis: isProtected
            ? 'Circuit breaker trips to OPEN within 3s, retry budget caps retries at 10%, and system recovers within 10s.'
            : 'Orders queue saturates and gateway retries cause 3x traffic amplification, crashing API gateway.',
          baselineDurationMicros: 15_000_000,
          faultDurationMicros: 20_000_000,
          cooldownDurationMicros: 15_000_000,
          detectors: [
            {
              name: 'Orders High Error Rate',
              detectorType: 'ERROR_RATE',
              thresholdValue: 50,
              windowDurationMicros: 2_000_000,
            },
            {
              name: 'Orders Breaker Tripped',
              detectorType: 'CIRCUIT_TRIPPED',
              thresholdValue: 1,
              windowDurationMicros: 1_000_000,
            },
          ],
        }),
      });

      if (createRes.ok) {
        const created = await createRes.json();
        // 2. Start Experiment Run
        const startRes = await fetch(
          `http://localhost:4000/api/v1/worlds/${worldId}/experiments/${created.id}/start`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ runtimeMode: 'LOGICAL', seed: '42' }),
          },
        );

        if (startRes.ok) {
          window.location.href = `/worlds/${worldId}/experiments/${created.id}`;
        }
      }
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLaunchingFlagship(false);
    }
  }

  function formatMicros(micros: string | number | null | undefined): string {
    if (!micros) return '—';
    const val = Number(micros) / 1_000_000;
    return `${val.toFixed(2)}s`;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-8">
      {/* Top Breadcrumb & Actions */}
      <div className="max-w-7xl mx-auto mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            href={`/worlds/${worldId}`}
            className="inline-flex items-center text-sm text-slate-400 hover:text-white transition mb-2"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to World Dashboard
          </Link>
          <div className="flex items-center space-x-3">
            <FlaskConical className="w-8 h-8 text-emerald-400" />
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">
                Reliability Experiments
              </h1>
              <p className="text-sm text-slate-400">
                Scientific chaos testing, anomaly detection, and MTTD/MTTR telemetry
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => handleLaunchFlagship(true)}
            disabled={launchingFlagship}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium text-sm flex items-center space-x-2 transition shadow-lg shadow-emerald-950 disabled:opacity-50"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Launch Flagship (Protected)</span>
          </button>
          <button
            onClick={() => handleLaunchFlagship(false)}
            disabled={launchingFlagship}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-medium text-sm flex items-center space-x-2 transition shadow-lg shadow-amber-950 disabled:opacity-50"
          >
            <Flame className="w-4 h-4" />
            <span>Launch Flagship (Collapse)</span>
          </button>
          <Link
            href={`/worlds/${worldId}/experiments/new`}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-medium text-sm flex items-center space-x-2 border border-slate-700 transition"
          >
            <Plus className="w-4 h-4" />
            <span>New Experiment</span>
          </Link>
        </div>
      </div>

      {error && (
        <div className="max-w-7xl mx-auto mb-6 p-4 bg-red-950/60 border border-red-800 rounded-lg text-red-200 text-sm flex items-center space-x-2">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 text-red-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Catalog Cards */}
      <div className="max-w-7xl mx-auto">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center space-x-2">
          <span>Experiment Catalog</span>
          <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full border border-slate-700">
            {experiments.length}
          </span>
        </h2>

        {loading ? (
          <div className="p-12 text-center text-slate-500">Loading experiments catalog...</div>
        ) : experiments.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center">
            <FlaskConical className="w-12 h-12 text-slate-600 mx-auto mb-4" />
            <h3 className="text-base font-semibold text-white mb-1">No experiments created yet</h3>
            <p className="text-sm text-slate-400 mb-6 max-w-md mx-auto">
              Launch the canonical Flagship Cascading Collapse scenario or create a custom
              experiment to measure MTTD and MTTR.
            </p>
            <button
              onClick={() => handleLaunchFlagship(true)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition inline-flex items-center space-x-2"
            >
              <Play className="w-4 h-4" />
              <span>Launch Flagship Scenario</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {experiments.map((exp) => {
              const isProtected =
                exp.name.toLowerCase().includes('protected') ||
                exp.name.toLowerCase().includes('shield');
              return (
                <Link
                  key={exp.id}
                  href={`/worlds/${worldId}/experiments/${exp.id}`}
                  className="group bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl p-6 transition flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <span
                        className={`text-xs px-2.5 py-1 rounded-full font-medium border ${
                          exp.status === 'RUNNING'
                            ? 'bg-blue-950 text-blue-400 border-blue-800 animate-pulse'
                            : exp.status === 'COMPLETED'
                              ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                              : exp.status === 'ABORTED'
                                ? 'bg-red-950 text-red-400 border-red-800'
                                : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        {exp.status}
                      </span>
                      {isProtected ? (
                        <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Flame className="w-4 h-4 text-amber-400" />
                      )}
                    </div>

                    <h3 className="text-base font-semibold text-white group-hover:text-emerald-400 transition mb-2">
                      {exp.name}
                    </h3>
                    <p className="text-xs text-slate-400 line-clamp-2 mb-4 leading-relaxed">
                      {exp.hypothesis}
                    </p>
                  </div>

                  <div className="border-t border-slate-800/80 pt-4 mt-2">
                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-400 mb-3">
                      <div>
                        <span className="text-slate-500 block">Baseline:</span>
                        <span className="font-mono text-slate-300">
                          {formatMicros(exp.baselineDurationMicros)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Fault Duration:</span>
                        <span className="font-mono text-slate-300">
                          {formatMicros(exp.faultDurationMicros)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span className="flex items-center">
                        <Clock className="w-3.5 h-3.5 mr-1 text-slate-500" />
                        {new Date(exp.createdAt).toLocaleDateString()}
                      </span>
                      <span className="text-emerald-400 flex items-center font-medium">
                        View Hero <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

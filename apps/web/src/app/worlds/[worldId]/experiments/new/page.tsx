'use client';

import React, { useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, FlaskConical, Plus, Trash2, AlertCircle } from 'lucide-react';

interface DetectorForm {
  name: string;
  detectorType: 'ERROR_RATE' | 'P99_LATENCY' | 'CIRCUIT_TRIPPED' | 'QUEUE_SATURATION';
  thresholdValue: number;
  windowDurationSeconds: number;
}

export default function NewExperimentPage({ params }: { params: Promise<{ worldId: string }> }) {
  const resolvedParams = use(params);
  const worldId = resolvedParams.worldId;
  const router = useRouter();

  const [name, setName] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [baselineSeconds, setBaselineSeconds] = useState(30);
  const [faultSeconds, setFaultSeconds] = useState(30);
  const [cooldownSeconds, setCooldownSeconds] = useState(15);
  const [detectors, setDetectors] = useState<DetectorForm[]>([
    {
      name: 'Service Error Rate Threshold',
      detectorType: 'ERROR_RATE',
      thresholdValue: 50,
      windowDurationSeconds: 2,
    },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addDetector() {
    setDetectors([
      ...detectors,
      {
        name: 'Latency Anomaly Detector',
        detectorType: 'P99_LATENCY',
        thresholdValue: 200,
        windowDurationSeconds: 2,
      },
    ]);
  }

  function removeDetector(index: number) {
    setDetectors(detectors.filter((_, i) => i !== index));
  }

  function updateDetector(
    index: number,
    field: keyof DetectorForm,
    value: DetectorForm[keyof DetectorForm],
  ) {
    const updated = [...detectors];
    updated[index] = { ...updated[index], [field]: value };
    setDetectors(updated);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`http://localhost:4000/api/v1/worlds/${worldId}/experiments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          hypothesis,
          baselineDurationMicros: baselineSeconds * 1_000_000,
          faultDurationMicros: faultSeconds * 1_000_000,
          cooldownDurationMicros: cooldownSeconds * 1_000_000,
          detectors: detectors.map((d) => ({
            name: d.name,
            detectorType: d.detectorType,
            thresholdValue: Number(d.thresholdValue),
            windowDurationMicros: d.windowDurationSeconds * 1_000_000,
          })),
        }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error?.message || 'Failed to create experiment');
      }

      const created = await res.json();
      router.push(`/worlds/${worldId}/experiments/${created.id}`);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-8">
      <div className="max-w-3xl mx-auto">
        <Link
          href={`/worlds/${worldId}/experiments`}
          className="inline-flex items-center text-sm text-slate-400 hover:text-white transition mb-6"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Experiments
        </Link>

        <div className="flex items-center space-x-3 mb-6">
          <FlaskConical className="w-8 h-8 text-emerald-400" />
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">New Experiment Wizard</h1>
            <p className="text-sm text-slate-400">
              Formulate a hypothesis, configure schedule durations, and set up anomaly detectors
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-950/60 border border-red-800 rounded-lg text-red-200 text-sm flex items-center space-x-2">
            <AlertCircle className="w-5 h-5 flex-shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Step 1: Definition */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <h2 className="text-base font-semibold text-white mb-4">1. Hypothesis & Definition</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Experiment Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Orders Circuit Breaker Cascade Isolation"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Scientific Hypothesis
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="e.g. If Payments latency degrades to 400ms, Orders circuit breaker trips before thread pool exhausts, preventing retry amplification to the Gateway."
                  value={hypothesis}
                  onChange={(e) => setHypothesis(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
          </div>

          {/* Step 2: Schedule */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <h2 className="text-base font-semibold text-white mb-4">
              2. Execution Timeline (Seconds)
            </h2>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Baseline Warmup (s)
                </label>
                <input
                  type="number"
                  min={5}
                  value={baselineSeconds}
                  onChange={(e) => setBaselineSeconds(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Fault Active Window (s)
                </label>
                <input
                  type="number"
                  min={5}
                  value={faultSeconds}
                  onChange={(e) => setFaultSeconds(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Cooldown Recovery (s)
                </label>
                <input
                  type="number"
                  min={5}
                  value={cooldownSeconds}
                  onChange={(e) => setCooldownSeconds(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
          </div>

          {/* Step 3: Anomaly Detectors */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-white">
                3. Anomaly Detectors (MTTD / MTTR)
              </h2>
              <button
                type="button"
                onClick={addDetector}
                className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg border border-slate-700 flex items-center space-x-1 transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Detector</span>
              </button>
            </div>

            <div className="space-y-3">
              {detectors.map((d, index) => (
                <div
                  key={index}
                  className="p-4 bg-slate-950 border border-slate-800 rounded-lg flex flex-wrap items-center gap-3"
                >
                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-[10px] text-slate-500 uppercase font-mono">
                      Detector Name
                    </label>
                    <input
                      type="text"
                      value={d.name}
                      onChange={(e) => updateDetector(index, 'name', e.target.value)}
                      className="w-full bg-transparent border-b border-slate-700 py-1 text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div className="w-40">
                    <label className="block text-[10px] text-slate-500 uppercase font-mono">
                      Type
                    </label>
                    <select
                      value={d.detectorType}
                      onChange={(e) => updateDetector(index, 'detectorType', e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:outline-none"
                    >
                      <option value="ERROR_RATE">ERROR_RATE (%)</option>
                      <option value="P99_LATENCY">P99_LATENCY (ms)</option>
                      <option value="CIRCUIT_TRIPPED">CIRCUIT_TRIPPED</option>
                      <option value="QUEUE_SATURATION">QUEUE_SATURATION (%)</option>
                    </select>
                  </div>

                  <div className="w-24">
                    <label className="block text-[10px] text-slate-500 uppercase font-mono">
                      Threshold
                    </label>
                    <input
                      type="number"
                      value={d.thresholdValue}
                      onChange={(e) =>
                        updateDetector(index, 'thresholdValue', Number(e.target.value))
                      }
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white font-mono focus:outline-none"
                    />
                  </div>

                  <div className="w-24">
                    <label className="block text-[10px] text-slate-500 uppercase font-mono">
                      Window (s)
                    </label>
                    <input
                      type="number"
                      value={d.windowDurationSeconds}
                      onChange={(e) =>
                        updateDetector(index, 'windowDurationSeconds', Number(e.target.value))
                      }
                      className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white font-mono focus:outline-none"
                    />
                  </div>

                  {detectors.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeDetector(index)}
                      className="text-slate-500 hover:text-red-400 p-1 rounded transition self-end"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-medium text-sm transition shadow-lg shadow-emerald-950 disabled:opacity-50"
          >
            {submitting ? 'Creating Experiment...' : 'Create and Proceed to Hero Screen'}
          </button>
        </form>
      </div>
    </div>
  );
}

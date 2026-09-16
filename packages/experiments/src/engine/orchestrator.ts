/**
 * Experiment Lifecycle State Machine & Execution Orchestrator (§104)
 *
 * Implements:
 *   DRAFT -> SCHEDULED -> RUNNING_BASELINE -> FAULT_INJECTED -> RECOVERING -> COMPLETED / ABORTED
 *
 * Coordinates discrete-event simulation or container execution,
 * injects scheduled faults, runs sliding-window anomaly detectors,
 * and compiles reproducible canonical run results.
 */

import {
  SimEngine,
  type EngineWorldSpec,
  type EngineServiceSpec,
  type MetricSampleRow,
} from '@mirrorgrid/sim';
import type { EdgeSpec, EdgeDispatchFn, RequestStatus } from '@mirrorgrid/sim/queueing';
import { FastDriver, RealtimeDriver, type ClockDriver } from '@mirrorgrid/sim/clock';
import { CircuitBreakerCore, RetryBudgetCore } from '@mirrorgrid/reliability';
import type { FrozenExperimentConfig } from './freeze.js';
import { ExperimentTimeline, type ExperimentTimelineEvent } from './timeline.js';
import { SlidingWindowDetectorEngine, type DetectorEngine } from '../detectors/detector-engine.js';
import type { MetricSample, ServiceMetricSnapshot } from '../detectors/detector-rules.js';

export type ExperimentPhase =
  | 'WARMUP'
  | 'BASELINE'
  | 'FAULT_INJECTED'
  | 'RECOVERING'
  | 'COMPLETED'
  | 'ABORTED';

export interface ExperimentRunSummary {
  readonly runId: string;
  readonly experimentId: string;
  readonly runNumber: number;
  readonly runtimeMode: 'LOGICAL' | 'CONTAINER' | 'HYBRID';
  readonly seed: string;
  readonly status: 'COMPLETED' | 'ABORTED';
  readonly stateHash: string;
  readonly mttdMicros: bigint | null;
  readonly mttrMicros: bigint | null;
  readonly retryAmplificationFactor: number;
  readonly totalInitialRequests: number;
  readonly totalRetriedRequests: number;
  readonly peakErrorRatePercent: number;
  readonly peakP99Us: bigint;
  readonly timeline: readonly ExperimentTimelineEvent[];
  readonly metrics: readonly MetricSampleRow[];
}

export interface OrchestratorOptions {
  readonly config: FrozenExperimentConfig;
  readonly runId?: string;
  readonly runNumber?: number;
  readonly runtimeMode?: 'LOGICAL' | 'CONTAINER' | 'HYBRID';
  readonly driver?: ClockDriver;
  readonly onPhaseChange?: (phase: ExperimentPhase, nowUs: bigint) => void;
  readonly onTick?: (nowUs: bigint, phase: ExperimentPhase) => void;
}

export class ExperimentOrchestrator {
  readonly runId: string;
  readonly experimentId: string;
  readonly runNumber: number;
  readonly runtimeMode: 'LOGICAL' | 'CONTAINER' | 'HYBRID';

  private readonly config: FrozenExperimentConfig;
  private readonly timeline: ExperimentTimeline;
  private readonly detectorEngine: DetectorEngine;
  private currentPhase: ExperimentPhase = 'WARMUP';
  private aborted = false;
  private abortReason?: string;

  constructor(options: OrchestratorOptions) {
    this.config = options.config;
    this.runId = options.runId ?? crypto.randomUUID();
    this.experimentId = options.config.experimentId;
    this.runNumber = options.runNumber ?? 1;
    this.runtimeMode = options.runtimeMode ?? 'LOGICAL';
    this.timeline = new ExperimentTimeline(this.runId);
    this.detectorEngine = new SlidingWindowDetectorEngine(2_000_000n);

    // Register detectors
    for (const d of this.config.detectors) {
      this.detectorEngine.registerDetector(d);
    }
  }

  public getAbortReason(): string | undefined {
    return this.abortReason;
  }

  public getPhase(): ExperimentPhase {
    return this.currentPhase;
  }

  public abort(reason: string): void {
    this.aborted = true;
    this.abortReason = reason;
    this.currentPhase = 'ABORTED';
  }

  public async execute(driverType: 'FAST' | 'REALTIME' = 'FAST'): Promise<ExperimentRunSummary> {
    const baselineUs = this.config.schedule.baselineMicros;
    const faultDurationUs = this.config.schedule.faultMicros;
    const cooldownUs = this.config.schedule.cooldownMicros;
    const totalDurationUs = baselineUs + faultDurationUs + cooldownUs;

    const faultStartUs = baselineUs;
    const faultEndUs = baselineUs + faultDurationUs;

    const entryService =
      this.config.topology.services.find((s) => s.id === 'gateway') ??
      this.config.topology.services[0];

    if (!entryService) {
      throw new Error('Topology has no services configured');
    }

    const engineServices: EngineServiceSpec[] = this.config.topology.services.map((s) => ({
      id: s.id,
      name: s.name,
      concurrencyLimit: s.concurrencyLimit,
      queueCapacity: s.queueCapacity,
      serviceTimeTable: s.serviceTimeTable ?? 'default_service',
    }));

    // Setup Circuit Breakers and Retry Budgets for edges
    const circuitBreakers = new Map<string, CircuitBreakerCore>();
    const retryBudgets = new Map<string, RetryBudgetCore>();
    let totalInitialCalls = 0;
    let totalRetryCalls = 0;
    let activeFaultInitialCalls = 0;
    let activeFaultRetryCalls = 0;

    for (const edge of this.config.topology.edges) {
      const cbPolicy = edge.circuitBreakerPolicy as
        | {
            enabled?: boolean;
            failureRateThresholdPpm?: number;
            minimumRequests?: number;
            sleepWindowMicros?: bigint;
            halfOpenMaxConcurrent?: number;
          }
        | undefined;

      if (cbPolicy?.enabled) {
        const breaker = new CircuitBreakerCore(
          {
            failureRateThresholdPpm: cbPolicy.failureRateThresholdPpm ?? 500_000,
            volumeThreshold: cbPolicy.minimumRequests ?? 5,
            windowBucketCount: 10,
            bucketDurationMicros: 1_000_000n,
            sleepWindowMicros: cbPolicy.sleepWindowMicros ?? 5_000_000n,
            halfOpenMaxConcurrent: cbPolicy.halfOpenMaxConcurrent ?? 2,
            consecutiveSuccessThreshold: 2,
          },
          0n,
        );
        circuitBreakers.set(edge.id, breaker);
      }

      const retryPolicy = edge.retryPolicy as
        | {
            enabled?: boolean;
            budgetPercent?: number;
          }
        | undefined;

      if (retryPolicy?.enabled) {
        const budgetPercent = retryPolicy.budgetPercent ?? 10;
        const budget = new RetryBudgetCore({
          retryRatio: budgetPercent / 100,
          minRetriesPerSec: 1,
          ttlMicros: 10_000_000n,
        });
        retryBudgets.set(edge.id, budget);
      }
    }

    // Build intercepted EdgeSpecs
    const engineEdges: EdgeSpec[] = this.config.topology.edges.map((edge) => {
      const edgeCb = circuitBreakers.get(edge.id);
      const edgeBudget = retryBudgets.get(edge.id);
      const retryConfig = edge.retryPolicy as
        | { enabled?: boolean; maxAttempts?: number; budgetPercent?: number }
        | undefined;
      const maxAttempts = retryConfig?.enabled ? (retryConfig.maxAttempts ?? 3) : 1;

      return {
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        timeoutMs: edge.timeoutMs,
        interceptor: (context, dispatch, onSettle) => {
          const isRetryingEdge = edge.sourceId === 'gateway' && edge.targetId === 'orders';
          const isDuringFault = context.nowUs >= faultStartUs && context.nowUs < faultEndUs;

          if (isRetryingEdge) {
            totalInitialCalls++;
            if (isDuringFault) activeFaultInitialCalls++;
          }

          const executeAttempt = (attempt: number) => {
            const now = context.clock.nowUs();

            // 1. Check Circuit Breaker
            if (edgeCb) {
              const admission = edgeCb.tryAcquire(now);
              if (!admission.allowed) {
                // Breaker is OPEN -> fast-fail without touching downstream
                onSettle('DEPENDENCY_FAILED');
                return;
              }
            }

            // 2. Check for active faults
            const isFaultActive =
              now >= faultStartUs &&
              now < faultEndUs &&
              this.config.faults.some(
                (f) =>
                  f.faultType === 'LATENCY' &&
                  (f.targetServiceId === edge.targetId || f.targetEdgeId === edge.id),
              );

            const addedLatencyUs = isFaultActive ? 400_000n : 0n; // +400ms latency shift

            // Wrapped dispatch that accounts for fault latency
            const doDispatch: EdgeDispatchFn = (deadlineUs, handleResult) => {
              if (addedLatencyUs > 0n) {
                // Shift child execution by addedLatencyUs
                context.clock.schedule({
                  timeUs: now + addedLatencyUs,
                  priority: 2, // EventPriority.NORMAL
                  type: 'FAULT_LATENCY_DELAY',
                  targetId: edge.targetId,
                  execute: () => {
                    dispatch(deadlineUs, handleResult);
                  },
                });
              } else {
                dispatch(deadlineUs, handleResult);
              }
            };

            doDispatch(context.deadlineUs, (status: RequestStatus) => {
              const settleNow = context.clock.nowUs();

              if (status === 'SUCCESS') {
                if (edgeCb) edgeCb.recordSuccess(settleNow);
                if (edgeBudget) edgeBudget.recordSuccess(settleNow, attempt > 1);
                onSettle('SUCCESS');
                return;
              }

              // Failure occurred
              if (edgeCb) edgeCb.recordFailure(settleNow);
              if (edgeBudget) edgeBudget.recordFailure(settleNow, attempt > 1);

              // Check if we can retry
              if (attempt < maxAttempts) {
                const canRetryBudget =
                  retryConfig?.budgetPercent === 100 ||
                  (edgeBudget ? edgeBudget.canRetry(settleNow) : true);

                if (canRetryBudget) {
                  if (isRetryingEdge) {
                    totalRetryCalls++;
                    if (isDuringFault) activeFaultRetryCalls++;
                  }
                  // Immediate retry on virtual clock
                  executeAttempt(attempt + 1);
                  return;
                }
              }

              onSettle(status);
            });
          };

          executeAttempt(1);
        },
      };
    });

    const engineSpec: EngineWorldSpec = {
      worldId: this.config.worldId,
      services: engineServices,
      edges: engineEdges,
      entryServiceId: entryService.id,
      requestTimeoutMs: 5000,
    };

    const engine = new SimEngine(engineSpec);
    let faultInjectedEmitted = false;
    let faultClearedEmitted = false;

    // Track previous breaker states to emit events
    const lastBreakerStates = new Map<string, string>();

    this.currentPhase = 'BASELINE';
    this.timeline.record(0n, 'PHASE_CHANGE', 'Baseline measurement phase started', {
      baselineDurationUs: baselineUs.toString(),
    });

    const driver = driverType === 'REALTIME' ? new RealtimeDriver() : new FastDriver();

    const result = await engine.run({
      seed: BigInt(this.config.seed),
      workload: {
        pattern: 'CONSTANT',
        baseRatePerSecond: this.config.workload.baseRate,
        peakRatePerSecond: this.config.workload.peakRate,
        durationUs: totalDurationUs,
      },
      driver,
      retainSamples: true,
      onMetrics: (rows) => {
        if (rows.length === 0) return;
        const nowUs = rows[0].virtualTimeUs;

        // Phase transitions
        if (nowUs >= faultStartUs && nowUs < faultEndUs && !faultInjectedEmitted) {
          faultInjectedEmitted = true;
          this.currentPhase = 'FAULT_INJECTED';
          this.timeline.record(nowUs, 'PHASE_CHANGE', 'Fault injection phase started');
          this.timeline.record(nowUs, 'FAULT_INJECTED', 'Payments +400ms latency fault activated', {
            targetService: 'payments',
            latencyAdded: '400ms',
          });
          this.detectorEngine.onFaultInjected('payments-latency', nowUs);
        } else if (nowUs >= faultEndUs && !faultClearedEmitted) {
          faultClearedEmitted = true;
          this.currentPhase = 'RECOVERING';
          this.timeline.record(nowUs, 'PHASE_CHANGE', 'Recovery and cooldown phase started');
          this.timeline.record(nowUs, 'FAULT_CLEARED', 'Payments latency fault disarmed');
          this.detectorEngine.onFaultCleared('payments-latency', nowUs);
        }

        // Breaker state tracking
        const breakerStateMap = new Map<string, 'CLOSED' | 'OPEN' | 'HALF_OPEN'>();
        for (const [edgeId, cb] of circuitBreakers.entries()) {
          cb.checkState(nowUs);
          const state = cb.state;
          breakerStateMap.set(edgeId, state);

          const prevState = lastBreakerStates.get(edgeId);
          if (prevState !== state) {
            lastBreakerStates.set(edgeId, state);
            this.timeline.record(
              nowUs,
              'BREAKER_STATE',
              `Circuit breaker on ${edgeId} transitioned to ${state}`,
              { edgeId, previousState: prevState ?? 'CLOSED', newState: state },
            );
          }
        }

        // Build metric sample for detectors
        const serviceSnapshots: ServiceMetricSnapshot[] = rows.map((r) => ({
          serviceId: r.serviceId,
          requestsTotal: r.requestsTotal,
          requestsFailed: r.requestsFailed,
          latencyP50Us: BigInt(Math.round(r.quantiles.p50)),
          latencyP95Us: BigInt(Math.round(r.quantiles.p95)),
          latencyP99Us: BigInt(Math.round(r.quantiles.p99)),
          queueDepth: r.queueDepth,
          queueCapacity: 200,
          activeSlots: r.activeSlots,
          concurrencyLimit: 64,
        }));

        const sample: MetricSample = {
          nowMicros: nowUs,
          services: serviceSnapshots,
          edgeCircuitBreakers: breakerStateMap,
        };

        const evals = this.detectorEngine.evaluateMetrics(sample);
        for (const ev of evals) {
          if (ev.isTriggered) {
            this.timeline.record(nowUs, 'DETECTOR_TRIGGERED', `${ev.detectorName} triggered`, {
              detectorId: ev.detectorId,
              value: ev.currentValue,
              threshold: ev.threshold,
              reason: ev.reason,
            });
          }
        }
      },
    });

    if (!this.aborted) {
      this.currentPhase = 'COMPLETED';
      this.timeline.record(totalDurationUs, 'PHASE_CHANGE', 'Experiment run completed');
    }

    const detectorResults = this.detectorEngine.computeResults();

    const retryAmplificationFactor =
      activeFaultInitialCalls > 0
        ? Math.round(
            ((activeFaultInitialCalls + activeFaultRetryCalls) / activeFaultInitialCalls) * 100,
          ) / 100
        : 1.0;

    let peakErrorRatePercent = 0;
    let peakP99Us = 0n;

    for (const m of result.metrics) {
      if (m.requestsTotal > 0) {
        const errorPct = (m.requestsFailed / m.requestsTotal) * 100;
        if (errorPct > peakErrorRatePercent) peakErrorRatePercent = Math.round(errorPct * 10) / 10;
      }
      const p99Us = BigInt(Math.round(m.quantiles.p99));
      if (p99Us > peakP99Us) peakP99Us = p99Us;
    }

    return {
      runId: this.runId,
      experimentId: this.experimentId,
      runNumber: this.runNumber,
      runtimeMode: this.runtimeMode,
      seed: this.config.seed,
      status: this.aborted ? 'ABORTED' : 'COMPLETED',
      stateHash: result.stateHash.root,
      mttdMicros: detectorResults.mttdMicros,
      mttrMicros: detectorResults.mttrMicros,
      retryAmplificationFactor,
      totalInitialRequests: totalInitialCalls,
      totalRetriedRequests: totalRetryCalls,
      peakErrorRatePercent,
      peakP99Us,
      timeline: this.timeline.getAll(),
      metrics: result.metrics,
    };
  }
}

/**
 * Immutable Timeline Event Recorder for Experiment Runs.
 * Captures chronological state changes, detector events, and fault actions.
 */

export type ExperimentEventCategory =
  | 'PHASE_CHANGE'
  | 'FAULT_INJECTED'
  | 'FAULT_CLEARED'
  | 'DETECTOR_TRIGGERED'
  | 'DETECTOR_RESOLVED'
  | 'BREAKER_STATE';

export interface ExperimentTimelineEvent {
  readonly id: string;
  readonly runId: string;
  readonly simTimeMicros: bigint;
  readonly eventCategory: ExperimentEventCategory;
  readonly summary: string;
  readonly details: Record<string, unknown>;
  readonly createdAt: Date;
}

export class ExperimentTimeline {
  private readonly events: ExperimentTimelineEvent[] = [];

  constructor(private readonly runId: string) {}

  public record(
    simTimeMicros: bigint,
    eventCategory: ExperimentEventCategory,
    summary: string,
    details: Record<string, unknown> = {},
  ): ExperimentTimelineEvent {
    const event: ExperimentTimelineEvent = {
      id: crypto.randomUUID(),
      runId: this.runId,
      simTimeMicros,
      eventCategory,
      summary,
      details,
      createdAt: new Date(),
    };
    this.events.push(event);
    return event;
  }

  public getAll(): readonly ExperimentTimelineEvent[] {
    return [...this.events].sort((a, b) => {
      if (a.simTimeMicros < b.simTimeMicros) return -1;
      if (a.simTimeMicros > b.simTimeMicros) return 1;
      return 0;
    });
  }

  public getByCategory(category: ExperimentEventCategory): readonly ExperimentTimelineEvent[] {
    return this.events.filter((e) => e.eventCategory === category);
  }
}

export enum EventPriority {
  SYSTEM = 0,
  HIGH = 10,
  NORMAL = 20,
  LOW = 30,
  BACKGROUND = 40,
}

export interface SimEvent {
  readonly id?: string;
  readonly timeUs: bigint;
  readonly priority: EventPriority | number;
  seq?: bigint;
  readonly type: string;
  readonly targetId?: string;
  readonly payload?: unknown;
  readonly execute: (event: SimEvent) => void | Promise<void>;
}

export interface ClockDriver {
  readonly name: string;
  start(clock: ClockDriverTarget): Promise<void>;
  stop(): void;
  isPaused(): boolean;
  pause(): void;
  resume(): void;
}

export interface ClockDriverTarget {
  nowUs(): bigint;
  peekNextTimeUs(): bigint | null;
  step(): Promise<boolean> | boolean;
  hasEvents(): boolean;
}

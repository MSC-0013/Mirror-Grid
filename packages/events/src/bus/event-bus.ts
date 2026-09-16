import EventEmitter from 'node:events';
import type { DomainEventEnvelope } from '../schemas/event-envelope.js';
import { TopicMatcher } from '../ws/topic-matcher.js';

export type EventHandler<T = unknown> = (
  event: DomainEventEnvelope<T>,
  topic: string,
) => void | Promise<void>;

export interface Subscription {
  readonly id: string;
  readonly topicPattern: string;
  unsubscribe(): void;
}

export class EventBus {
  private static instance: EventBus | null = null;
  private readonly emitter = new EventEmitter();
  private readonly subscriptions = new Map<
    string,
    { pattern: string; handler: EventHandler<unknown> }
  >();
  private subCounter = 0;
  private publishedCount = 0;
  private deliveredCount = 0;

  constructor() {
    this.emitter.setMaxListeners(1000);
  }

  public static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  public static resetInstance(): void {
    if (EventBus.instance) {
      EventBus.instance.clear();
      EventBus.instance = null;
    }
  }

  public subscribe<T = unknown>(topicPattern: string, handler: EventHandler<T>): Subscription {
    const id = `sub_${++this.subCounter}`;
    this.subscriptions.set(id, {
      pattern: topicPattern,
      handler: handler as EventHandler<unknown>,
    });

    return {
      id,
      topicPattern,
      unsubscribe: () => {
        this.subscriptions.delete(id);
      },
    };
  }

  public async publish<T = unknown>(
    topic: string,
    event: DomainEventEnvelope<T>,
  ): Promise<{ delivered: number }> {
    this.publishedCount++;
    let delivered = 0;
    const promises: Promise<void>[] = [];

    for (const [, sub] of this.subscriptions) {
      if (TopicMatcher.matches(sub.pattern, topic)) {
        delivered++;
        this.deliveredCount++;
        try {
          const res = sub.handler(event, topic);
          if (res instanceof Promise) {
            promises.push(
              res.catch((err) => {
                console.error(`[EventBus] Handler error for topic ${topic}:`, err);
              }),
            );
          }
        } catch (err) {
          console.error(`[EventBus] Synchronous handler error for topic ${topic}:`, err);
        }
      }
    }

    if (promises.length > 0) {
      await Promise.all(promises);
    }

    return { delivered };
  }

  public clear(): void {
    this.subscriptions.clear();
    this.emitter.removeAllListeners();
    this.publishedCount = 0;
    this.deliveredCount = 0;
  }

  public getStats() {
    return {
      subscribersCount: this.subscriptions.size,
      publishedCount: this.publishedCount,
      deliveredCount: this.deliveredCount,
    };
  }
}

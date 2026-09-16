import { OutboxRelay, ActivityProjector, WebSocketGateway } from '@mirrorgrid/events';

let outboxRelay: OutboxRelay | null = null;
let activityProjector: ActivityProjector | null = null;
let wsGateway: WebSocketGateway | null = null;

export function getOutboxRelay(): OutboxRelay {
  if (!outboxRelay) {
    outboxRelay = new OutboxRelay({ batchSize: 100, pollIntervalMs: 100 });
  }
  return outboxRelay;
}

export function getActivityProjector(): ActivityProjector {
  if (!activityProjector) {
    activityProjector = new ActivityProjector();
  }
  return activityProjector;
}

export function getWebSocketGateway(): WebSocketGateway {
  if (!wsGateway) {
    wsGateway = new WebSocketGateway({ path: '/api/v1/ws' });
  }
  return wsGateway;
}

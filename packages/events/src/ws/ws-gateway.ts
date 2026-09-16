import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { EventBus, type Subscription } from '../bus/event-bus.js';
import { TopicMatcher } from './topic-matcher.js';
import type { ClientMessage, ServerMessage } from './ws-protocol.js';

export interface WebSocketGatewayOptions {
  path?: string;
  heartbeatIntervalMs?: number;
}

interface ExtendedWebSocket extends WebSocket {
  isAlive: boolean;
  subscriptions: Set<string>;
}

export class WebSocketGateway {
  private wss: WebSocketServer | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private busSubscription: Subscription | null = null;
  private readonly path: string;
  private readonly heartbeatIntervalMs: number;

  constructor(options: WebSocketGatewayOptions = {}) {
    this.path = options.path ?? '/api/v1/ws';
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30000;
  }

  /**
   * Attaches the WebSocket gateway to an existing HTTP server.
   */
  public attach(server: HttpServer): void {
    if (this.wss) {
      throw new Error('WebSocketGateway already attached');
    }

    this.wss = new WebSocketServer({
      server,
      path: this.path,
    });

    this.wss.on('connection', (ws: WebSocket) => {
      const extWs = ws as ExtendedWebSocket;
      extWs.isAlive = true;
      extWs.subscriptions = new Set();

      extWs.on('pong', () => {
        extWs.isAlive = true;
      });

      extWs.on('message', (data: Buffer | string) => {
        try {
          const raw = typeof data === 'string' ? data : data.toString('utf8');
          const message = JSON.parse(raw) as ClientMessage;
          this.handleClientMessage(extWs, message);
        } catch (err) {
          this.sendMessage(extWs, {
            type: 'error',
            code: 'INVALID_JSON',
            message: err instanceof Error ? err.message : 'Invalid JSON message',
          });
        }
      });

      extWs.on('error', (err) => {
        console.error('[WebSocketGateway] Client socket error:', err);
      });
    });

    // Start heartbeat timer to reap zombie connections
    this.heartbeatInterval = setInterval(() => {
      if (!this.wss) return;
      for (const client of this.wss.clients) {
        const extWs = client as ExtendedWebSocket;
        if (!extWs.isAlive) {
          extWs.terminate();
          continue;
        }
        extWs.isAlive = false;
        extWs.ping();
      }
    }, this.heartbeatIntervalMs);

    // Subscribe to EventBus to fan out messages to matching WebSocket clients
    const bus = EventBus.getInstance();
    this.busSubscription = bus.subscribe('*', (event, topic) => {
      this.broadcastToSubscribers(topic, event);
    });
  }

  private handleClientMessage(ws: ExtendedWebSocket, message: ClientMessage): void {
    switch (message.action) {
      case 'subscribe':
        ws.subscriptions.add(message.topic);
        this.sendMessage(ws, { type: 'subscribed', topic: message.topic });
        break;

      case 'unsubscribe':
        ws.subscriptions.delete(message.topic);
        this.sendMessage(ws, { type: 'unsubscribed', topic: message.topic });
        break;

      case 'ping':
        this.sendMessage(ws, { type: 'pong' });
        break;

      default:
        this.sendMessage(ws, {
          type: 'error',
          code: 'UNKNOWN_ACTION',
          message: `Unknown action: ${(message as { action: string }).action}`,
        });
    }
  }

  private sendMessage(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  public broadcastToSubscribers(topic: string, data: unknown): number {
    if (!this.wss) return 0;
    let recipients = 0;
    const payload = JSON.stringify({ type: 'event', topic, data });

    for (const client of this.wss.clients) {
      const extWs = client as ExtendedWebSocket;
      if (extWs.readyState === WebSocket.OPEN) {
        for (const pattern of extWs.subscriptions) {
          if (TopicMatcher.matches(pattern, topic)) {
            extWs.send(payload);
            recipients++;
            break;
          }
        }
      }
    }

    return recipients;
  }

  public getConnectedClientsCount(): number {
    return this.wss?.clients.size ?? 0;
  }

  public close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }
      if (this.busSubscription) {
        this.busSubscription.unsubscribe();
        this.busSubscription = null;
      }
      if (this.wss) {
        for (const client of this.wss.clients) {
          client.terminate();
        }
        this.wss.close(() => {
          this.wss = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

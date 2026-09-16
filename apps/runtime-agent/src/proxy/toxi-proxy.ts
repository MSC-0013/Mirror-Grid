import net from 'node:net';

export interface ToxicConfig {
  type: 'latency' | 'drop' | 'reset';
  latencyMs?: number;
  dropRatio?: number;
}

export class UserSpaceToxiProxy {
  public readonly listenPort: number;
  public readonly targetHost: string;
  public readonly targetPort: number;

  private server: net.Server | null = null;
  private readonly toxics: ToxicConfig[] = [];
  private readonly activeSockets = new Set<net.Socket>();

  constructor(listenPort: number, targetHost: string, targetPort: number) {
    this.listenPort = listenPort;
    this.targetHost = targetHost;
    this.targetPort = targetPort;
  }

  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((inboundSocket) => {
        this.handleConnection(inboundSocket);
      });

      this.server.on('error', reject);
      this.server.listen(this.listenPort, '127.0.0.1', () => {
        resolve();
      });
    });
  }

  public addToxic(toxic: ToxicConfig): void {
    this.toxics.push(toxic);
  }

  public clearToxics(): void {
    this.toxics.length = 0;
  }

  public async stop(): Promise<void> {
    for (const socket of this.activeSockets) {
      socket.destroy();
    }
    this.activeSockets.clear();

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server?.close(() => resolve());
      });
      this.server = null;
    }
  }

  private handleConnection(inboundSocket: net.Socket): void {
    this.activeSockets.add(inboundSocket);

    // Check for drop / reset toxic on connection
    for (const t of this.toxics) {
      if (t.type === 'reset') {
        inboundSocket.destroy();
        this.activeSockets.delete(inboundSocket);
        return;
      }
      if (t.type === 'drop' && t.dropRatio && Math.random() < t.dropRatio) {
        inboundSocket.destroy();
        this.activeSockets.delete(inboundSocket);
        return;
      }
    }

    const outboundSocket = net.connect(this.targetPort, this.targetHost);
    this.activeSockets.add(outboundSocket);

    // Calculate latency toxic
    let latencyMs = 0;
    for (const t of this.toxics) {
      if (t.type === 'latency' && t.latencyMs) {
        latencyMs += t.latencyMs;
      }
    }

    inboundSocket.on('data', (chunk) => {
      if (latencyMs > 0) {
        setTimeout(() => {
          if (!outboundSocket.destroyed) outboundSocket.write(chunk);
        }, latencyMs);
      } else {
        outboundSocket.write(chunk);
      }
    });

    outboundSocket.on('data', (chunk) => {
      if (latencyMs > 0) {
        setTimeout(() => {
          if (!inboundSocket.destroyed) inboundSocket.write(chunk);
        }, latencyMs);
      } else {
        inboundSocket.write(chunk);
      }
    });

    const cleanup = () => {
      this.activeSockets.delete(inboundSocket);
      this.activeSockets.delete(outboundSocket);
      if (!inboundSocket.destroyed) inboundSocket.destroy();
      if (!outboundSocket.destroyed) outboundSocket.destroy();
    };

    inboundSocket.on('error', cleanup);
    outboundSocket.on('error', cleanup);
    inboundSocket.on('close', cleanup);
    outboundSocket.on('close', cleanup);
  }
}

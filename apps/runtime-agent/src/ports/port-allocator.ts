import net from 'node:net';

export class PortAllocator {
  private readonly reservedPorts = new Set<number>();

  /**
   * Discovers a free ephemeral port by binding to 0, then releasing.
   */
  public async allocatePort(): Promise<number> {
    for (let attempt = 0; attempt < 50; attempt++) {
      const port = await this.findAvailablePort();
      if (!this.reservedPorts.has(port)) {
        this.reservedPorts.add(port);
        return port;
      }
    }
    throw new Error('Failed to allocate free host port after 50 attempts');
  }

  public async allocatePortPair(): Promise<{ servicePort: number; adminPort: number }> {
    const servicePort = await this.allocatePort();
    const adminPort = await this.allocatePort();
    return { servicePort, adminPort };
  }

  public releasePort(port: number): void {
    this.reservedPorts.delete(port);
  }

  public releaseAll(): void {
    this.reservedPorts.clear();
  }

  private findAvailablePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          server.close(() => reject(new Error('Invalid socket address')));
          return;
        }
        const port = address.port;
        server.close((err) => {
          if (err) reject(err);
          else resolve(port);
        });
      });
    });
  }
}

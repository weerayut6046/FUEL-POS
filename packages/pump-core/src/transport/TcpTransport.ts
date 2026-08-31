import net from 'node:net';
import { Transport } from './Transport.js';

/**
 * เชื่อมต่อผ่าน RS485-to-Ethernet gateway (เช่น USR-TCP232-304, Elfin EW11)
 * เหมาะกับกรณีที่เครื่อง POS อยู่ไกลจากตู้จ่าย หรือมีหลายเครื่องต้องใช้บัสร่วมกัน
 */
export class TcpTransport extends Transport {
  private socket: net.Socket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private closing = false;

  constructor(
    id: string,
    private readonly host: string,
    private readonly port: number,
    private readonly reconnectDelayMs = 3000,
  ) {
    super(id);
  }

  describe(): string {
    return `tcp://${this.host}:${this.port}`;
  }

  open(): Promise<void> {
    this.closing = false;
    return new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      this.socket = socket;
      socket.setNoDelay(true);
      // กัน gateway ตัดการเชื่อมต่อเงียบ ๆ
      socket.setKeepAlive(true, 10_000);

      const onError = (err: Error) => {
        this.emit('error', err);
        if (!this._open) reject(err);
      };

      socket.on('data', (chunk) => this.emit('data', new Uint8Array(chunk)));
      socket.on('error', onError);
      socket.on('close', () => {
        this._open = false;
        this.emit('close');
        this.scheduleReconnect();
      });

      socket.connect(this.port, this.host, () => {
        this._open = true;
        this.emit('open');
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    this.closing = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.destroy();
    this.socket = null;
    this._open = false;
  }

  write(data: Uint8Array): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.socket || !this._open) {
        reject(new Error(`ยังไม่ได้เชื่อมต่อ ${this.describe()}`));
        return;
      }
      this.socket.write(Buffer.from(data), (err) => (err ? reject(err) : resolve()));
    });
  }

  private scheduleReconnect(): void {
    if (this.closing || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open().catch((err: Error) => this.emit('error', err));
    }, this.reconnectDelayMs);
  }
}

import type { FastifyInstance } from 'fastify';
import type { ServerEvent } from '@fuel-pos/shared';
import { toHex } from '@fuel-pos/pump-core';
import type { AppContext } from './context.js';

interface Client {
  send: (data: string) => void;
  /** บัสที่ลูกค้ารายนี้ขอดูข้อมูลดิบ (หน้า Protocol Lab เท่านั้น) */
  trafficBusId: string | null;
}

export const APP_VERSION = '0.1.0';

/**
 * ช่องทางส่งสถานะสดไปหน้าจอ POS
 *
 * ใช้ WebSocket เพราะหน้าจอต้องเห็นตัวเลขลิตร/บาทเดินแบบเรียลไทม์
 * การ poll ผ่าน HTTP ทุก 300 ms จะหนักเกินไปเมื่อมีหลายเครื่อง
 */
export function registerWebSocket(app: FastifyInstance, ctx: AppContext): void {
  const clients = new Set<Client>();

  const broadcast = (event: ServerEvent): void => {
    const payload = JSON.stringify(event);
    for (const client of clients) {
      try {
        client.send(payload);
      } catch {
        clients.delete(client);
      }
    }
  };

  // ส่งต่อเหตุการณ์จากระบบตู้จ่ายไปยังทุกหน้าจอ
  ctx.pumps.on('nozzle', (nozzle) => broadcast({ type: 'nozzle.update', nozzle }));
  ctx.pumps.on('sale', (sale) => broadcast({ type: 'sale.created', sale }));
  ctx.pumps.on('busStatus', ({ busId, connected, error }) =>
    broadcast({ type: 'bus.status', busId, connected, error }),
  );
  ctx.pumps.on('log', ({ level, message }) =>
    broadcast({ type: 'toast', level, message }),
  );

  // ข้อมูลดิบบนบัสส่งเฉพาะให้เครื่องที่เปิดหน้า Protocol Lab อยู่
  // (ปริมาณมาก ถ้าส่งให้ทุกเครื่องจะกินแบนด์วิดท์เปล่า)
  ctx.pumps.on('traffic', ({ busId, direction, bytes, at }) => {
    const payload = JSON.stringify({
      type: 'bus.traffic',
      busId,
      direction,
      hex: toHex(bytes),
      at,
    } satisfies ServerEvent);
    for (const client of clients) {
      if (client.trafficBusId === busId || client.trafficBusId === '*') {
        try {
          client.send(payload);
        } catch {
          clients.delete(client);
        }
      }
    }
  });

  app.get('/ws', { websocket: true }, (socket) => {
    const client: Client = {
      send: (data) => socket.send(data),
      trafficBusId: null,
    };
    clients.add(client);

    client.send(
      JSON.stringify({
        type: 'hello',
        serverTime: Date.now(),
        version: APP_VERSION,
      } satisfies ServerEvent),
    );
    client.send(
      JSON.stringify({
        type: 'nozzles.snapshot',
        nozzles: ctx.pumps.snapshot(),
      } satisfies ServerEvent),
    );

    socket.on('message', (raw: Buffer) => {
      try {
        const message = JSON.parse(raw.toString()) as { type: string; busId?: string };
        if (message.type === 'subscribe.traffic') {
          client.trafficBusId = message.busId ?? null;
        }
      } catch {
        /* ข้อความที่อ่านไม่ออก — ไม่ต้องทำอะไร */
      }
    });

    socket.on('close', () => clients.delete(client));
    socket.on('error', () => clients.delete(client));
  });

  // ส่งการเปลี่ยนแปลงราคา/กะ ให้ทุกหน้าจออัปเดตพร้อมกัน
  app.decorate('broadcast', broadcast);
}

declare module 'fastify' {
  interface FastifyInstance {
    broadcast: (event: ServerEvent) => void;
  }
}

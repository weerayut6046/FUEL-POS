import { useCallback, useEffect, useRef, useState } from 'react';
import type { NozzleLiveState, Product, Sale, ServerEvent, Shift } from '@fuel-pos/shared';
import { api, getToken } from './api.js';

export interface Toast {
  id: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface LiveState {
  nozzles: NozzleLiveState[];
  products: Product[];
  shift: Shift | null;
  pendingSales: Sale[];
  mode: 'simulator' | 'hardware';
  connected: boolean;
  toasts: Toast[];
  /** ข้อมูลดิบบนบัส (เฉพาะเมื่อสมัครรับใน Protocol Lab) */
  traffic: { direction: 'tx' | 'rx'; hex: string; at: number }[];
}

/**
 * สถานะสดของหน้าลาน
 *
 * ใช้ WebSocket เป็นหลักเพื่อให้ตัวเลขลิตร/บาทเดินทันที
 * และมี polling ทุก 5 วินาทีเป็นตาข่ายรองรับ เผื่อ WebSocket หลุดโดยไม่รู้ตัว
 */
export function useLive(enabled: boolean) {
  const [state, setState] = useState<LiveState>({
    nozzles: [],
    products: [],
    shift: null,
    pendingSales: [],
    mode: 'simulator',
    connected: false,
    toasts: [],
    traffic: [],
  });

  const socketRef = useRef<WebSocket | null>(null);
  const toastId = useRef(0);
  const trafficBus = useRef<string | null>(null);

  const pushToast = useCallback((level: Toast['level'], message: string) => {
    const id = ++toastId.current;
    setState((prev) => ({ ...prev, toasts: [...prev.toasts, { id, level, message }] }));
    setTimeout(() => {
      setState((prev) => ({ ...prev, toasts: prev.toasts.filter((t) => t.id !== id) }));
    }, 6000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const live = await api.live();
      setState((prev) => ({
        ...prev,
        nozzles: live.nozzles,
        products: live.products,
        shift: live.shift,
        pendingSales: live.pendingSales,
        mode: live.mode,
      }));
    } catch {
      /* ปล่อยให้ตาข่ายรองรับรอบถัดไปลองใหม่ */
    }
  }, []);

  const subscribeTraffic = useCallback((busId: string | null) => {
    trafficBus.current = busId;
    setState((prev) => ({ ...prev, traffic: [] }));
    socketRef.current?.send(JSON.stringify({ type: 'subscribe.traffic', busId }));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();

    let closed = false;
    let reconnectTimer: number | undefined;

    const connect = () => {
      if (closed) return;
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
      const socket = new WebSocket(`${protocol}://${location.host}/ws`);
      socketRef.current = socket;

      socket.onopen = () => {
        setState((prev) => ({ ...prev, connected: true }));
        if (trafficBus.current) {
          socket.send(JSON.stringify({ type: 'subscribe.traffic', busId: trafficBus.current }));
        }
      };

      socket.onclose = () => {
        setState((prev) => ({ ...prev, connected: false }));
        if (!closed) reconnectTimer = window.setTimeout(connect, 2000);
      };

      socket.onmessage = (event) => {
        const message = JSON.parse(event.data as string) as ServerEvent;
        setState((prev) => {
          switch (message.type) {
            case 'nozzles.snapshot':
              return { ...prev, nozzles: message.nozzles };

            case 'nozzle.update': {
              const next = prev.nozzles.some((n) => n.nozzleId === message.nozzle.nozzleId)
                ? prev.nozzles.map((n) =>
                    n.nozzleId === message.nozzle.nozzleId ? message.nozzle : n,
                  )
                : [...prev.nozzles, message.nozzle];
              return { ...prev, nozzles: next };
            }

            case 'sale.created':
              return {
                ...prev,
                pendingSales: prev.pendingSales.some((s) => s.id === message.sale.id)
                  ? prev.pendingSales
                  : [...prev.pendingSales, message.sale],
              };

            case 'sale.paid':
              return {
                ...prev,
                pendingSales: prev.pendingSales.filter((s) => s.id !== message.sale.id),
              };

            case 'shift.changed':
              return { ...prev, shift: message.shift };

            case 'products.changed':
              return { ...prev, products: message.products };

            case 'bus.traffic':
              return {
                ...prev,
                // เก็บไว้ 500 บรรทัดล่าสุดพอ — มากกว่านี้หน้าจอจะหน่วง
                traffic: [
                  ...prev.traffic.slice(-499),
                  { direction: message.direction, hex: message.hex, at: message.at },
                ],
              };

            case 'toast': {
              const id = ++toastId.current;
              setTimeout(() => {
                setState((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) }));
              }, 6000);
              return {
                ...prev,
                toasts: [...prev.toasts, { id, level: message.level, message: message.message }],
              };
            }

            default:
              return prev;
          }
        });
      };
    };

    connect();
    const poll = window.setInterval(() => void refresh(), 5000);

    return () => {
      closed = true;
      window.clearInterval(poll);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
    // getToken() ใช้เพื่อให้ hook ต่อใหม่เมื่อผู้ใช้เปลี่ยน
  }, [enabled, refresh, getToken()]);

  return { state, refresh, pushToast, subscribeTraffic };
}

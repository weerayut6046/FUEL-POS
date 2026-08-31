import type { ProtocolProfile, SerialSettings } from '@fuel-pos/shared';
import { Bus } from '../bus/Bus.js';
import { SerialTransport } from '../transport/SerialTransport.js';
import { delay } from '../transport/Transport.js';
import { ProfileCodec } from '../protocol/ProfileCodec.js';
import { toHex } from '../util/bytes.js';
import { guessFrameBoundaries, guessChecksum } from './analyzer.js';

export interface SniffResult {
  /** บล็อกข้อมูลที่มาติดกัน (คั่นด้วยช่องว่างเวลา) */
  blocks: Uint8Array[];
  totalBytes: number;
  durationMs: number;
}

export interface BaudScanResult {
  baudRate: number;
  bytes: number;
  blocks: number;
  /** คะแนนความน่าจะเป็นว่า baud นี้ถูกต้อง (สูง = ดี) */
  score: number;
  sample: string;
}

export interface AddressProbeResult {
  address: number;
  responded: boolean;
  responseHex: string | null;
  error: string | null;
}

/** baud rate ที่ตู้จ่ายจีนใช้บ่อย เรียงตามความน่าจะเป็น */
export const COMMON_BAUD_RATES = [9600, 4800, 19200, 2400, 38400, 1200, 57600, 115200];

/**
 * เครื่องมือสำรวจบัส สำหรับหาโปรโตคอลของตู้ที่ไม่มีเอกสาร
 */
export class BusScanner {
  /**
   * ดักฟังข้อมูลบนบัสแบบไม่ส่งอะไรออกไป (passive)
   * ใช้เมื่อมีอุปกรณ์อื่น (POS เดิม/เครื่องอ่านของผู้ผลิต) คุยกับตู้อยู่แล้ว
   */
  static async sniff(
    path: string,
    settings: SerialSettings,
    durationMs: number,
    silenceMs = 20,
  ): Promise<SniffResult> {
    const transport = new SerialTransport(`sniff-${path}`, path, settings, 0);
    const blocks: Uint8Array[] = [];
    let current: number[] = [];
    let timer: NodeJS.Timeout | null = null;
    let totalBytes = 0;

    const flush = () => {
      if (current.length > 0) {
        blocks.push(Uint8Array.from(current));
        current = [];
      }
      timer = null;
    };

    transport.on('data', (chunk) => {
      totalBytes += chunk.length;
      for (const b of chunk) current.push(b);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, silenceMs);
    });

    const startedAt = Date.now();
    await transport.open();
    await delay(durationMs);
    if (timer) clearTimeout(timer);
    flush();
    await transport.close();

    return { blocks, totalBytes, durationMs: Date.now() - startedAt };
  }

  /**
   * ลองฟังทีละ baud rate เพื่อหาว่าตู้ใช้ความเร็วเท่าไร
   *
   * หลักการให้คะแนน: ถ้า baud ถูกต้อง ข้อมูลจะมาเป็นบล็อกขนาดสม่ำเสมอ
   * ถ้าผิด จะได้ไบต์มั่ว ๆ ขนาดไม่แน่นอน หรือไม่ได้อะไรเลย
   */
  static async scanBaudRates(
    path: string,
    baudRates: number[] = COMMON_BAUD_RATES,
    perBaudMs = 3000,
    base: Omit<SerialSettings, 'baudRate'> = { dataBits: 8, stopBits: 1, parity: 'none' },
  ): Promise<BaudScanResult[]> {
    const results: BaudScanResult[] = [];

    for (const baudRate of baudRates) {
      try {
        const sniff = await BusScanner.sniff(path, { ...base, baudRate }, perBaudMs);
        results.push({
          baudRate,
          bytes: sniff.totalBytes,
          blocks: sniff.blocks.length,
          score: scoreBlocks(sniff.blocks),
          sample: sniff.blocks[0] ? toHex(sniff.blocks[0].subarray(0, 24)) : '',
        });
      } catch (err) {
        results.push({
          baudRate,
          bytes: 0,
          blocks: 0,
          score: -1,
          sample: `เปิดพอร์ตไม่สำเร็จ: ${(err as Error).message}`,
        });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * ยิงคำสั่ง status ไปทีละ address เพื่อหาว่ามีตู้อยู่ที่ address ไหนบ้าง (active)
   * ใช้เมื่อรู้โปรโตคอลแล้ว แต่ไม่รู้ว่าช่างตั้ง address ไว้เท่าไร
   */
  static async probeAddresses(
    bus: Bus,
    profile: ProtocolProfile,
    fromAddress = 0,
    toAddress = 16,
    onProgress?: (result: AddressProbeResult) => void,
  ): Promise<AddressProbeResult[]> {
    const codec = new ProfileCodec(profile);
    const results: AddressProbeResult[] = [];

    for (let address = fromAddress; address <= toAddress; address++) {
      let result: AddressProbeResult;
      try {
        const frame = codec.buildRequest('status', address, { nozzle: 1 });
        const response = await bus.request(frame, {
          timeoutMs: profile.timing.responseTimeoutMs,
          expectResponse: true,
          retries: 0,
        });
        result = {
          address,
          responded: response !== null,
          responseHex: response ? toHex(response) : null,
          error: null,
        };
      } catch (err) {
        result = {
          address,
          responded: false,
          responseHex: null,
          error: (err as Error).message,
        };
      }
      results.push(result);
      onProgress?.(result);
    }

    return results;
  }

  /** วิเคราะห์ผลการดักฟังให้เป็นข้อเสนอแนะเริ่มต้นของ profile */
  static suggestProfile(blocks: Uint8Array[]): {
    boundaries: ReturnType<typeof guessFrameBoundaries>;
    checksums: ReturnType<typeof guessChecksum>;
  } {
    return {
      boundaries: guessFrameBoundaries(blocks),
      checksums: guessChecksum(blocks),
    };
  }
}

/**
 * ให้คะแนนชุดบล็อก: baud ที่ถูกต้องมักได้บล็อกจำนวนพอสมควร
 * และความยาวบล็อกกระจุกตัวอยู่ไม่กี่ค่า
 */
function scoreBlocks(blocks: Uint8Array[]): number {
  if (blocks.length === 0) return 0;
  const lengths = new Map<number, number>();
  for (const b of blocks) lengths.set(b.length, (lengths.get(b.length) ?? 0) + 1);

  const distinctRatio = lengths.size / blocks.length; // ยิ่งน้อยยิ่งสม่ำเสมอ
  const mostCommon = Math.max(...lengths.values());
  const consistency = mostCommon / blocks.length;

  // บล็อกสั้นมาก (1-2 ไบต์) มักเป็นสัญญาณรบกวนจาก baud ผิด
  const shortNoise = blocks.filter((b) => b.length <= 2).length / blocks.length;

  return Math.round((consistency * 100 - distinctRatio * 50 - shortNoise * 60) * 10) / 10;
}

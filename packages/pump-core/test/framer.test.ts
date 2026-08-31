import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import type { FramingSpec } from '@fuel-pos/shared';

import { Framer } from '../src/framing/Framer.js';
import { fromHex, toHex } from '../src/util/bytes.js';

const delimited: FramingSpec = {
  kind: 'delimited',
  stx: [0x02],
  etx: [0x03],
  escape: null,
  maxLength: 64,
};

function collect(spec: FramingSpec): { framer: Framer; frames: string[] } {
  const frames: string[] = [];
  const framer = new Framer(spec, (f) => frames.push(toHex(f)));
  return { framer, frames };
}

describe('Framer โหมด delimited', () => {
  test('ตัดเฟรมเดียวที่มาครบในครั้งเดียว', () => {
    const { framer, frames } = collect(delimited);
    framer.push(fromHex('02 01 11 01 13 03'));
    assert.deepEqual(frames, ['02 01 11 01 13 03']);
  });

  test('ประกอบเฟรมที่ถูกแบ่งมาหลายก้อนได้', () => {
    const { framer, frames } = collect(delimited);
    framer.push(fromHex('02 01'));
    framer.push(fromHex('11'));
    assert.deepEqual(frames, [], 'ยังไม่ครบเฟรม ต้องยังไม่ส่งออก');
    framer.push(fromHex('01 13 03'));
    assert.deepEqual(frames, ['02 01 11 01 13 03']);
  });

  test('แยกสองเฟรมที่มาติดกันใน chunk เดียว', () => {
    const { framer, frames } = collect(delimited);
    framer.push(fromHex('02 01 11 01 13 03 02 02 11 01 14 03'));
    assert.deepEqual(frames, ['02 01 11 01 13 03', '02 02 11 01 14 03']);
  });

  test('ทิ้งขยะที่มาก่อน STX', () => {
    const { framer, frames } = collect(delimited);
    framer.push(fromHex('FF AA 55 02 01 11 01 13 03'));
    assert.deepEqual(frames, ['02 01 11 01 13 03']);
  });

  test('ไม่ค้างเมื่อได้ข้อมูลขยะยาวเกิน maxLength', () => {
    const { framer, frames } = collect({ ...delimited, maxLength: 8 } as FramingSpec);
    framer.push(new Uint8Array(200).fill(0xaa));
    framer.push(fromHex('02 01 11 01 13 03'));
    assert.deepEqual(frames, ['02 01 11 01 13 03']);
  });

  test('รองรับ byte stuffing', () => {
    const spec: FramingSpec = { ...delimited, escape: 0x10 } as FramingSpec;
    const { framer, frames } = collect(spec);
    // ข้อมูลมี 0x03 อยู่ข้างใน จึงถูก escape ด้วย 0x10
    framer.push(fromHex('02 01 10 03 04 03'));
    assert.deepEqual(frames, ['02 01 03 04 03']);
  });
});

describe('Framer โหมด length', () => {
  const spec: FramingSpec = {
    kind: 'length',
    stx: [0x7e],
    lengthAt: 1,
    lengthBytes: 1,
    lengthEndian: 'be',
    lengthIncludes: 'payload',
    maxLength: 64,
  };

  test('ใช้ไบต์ความยาวตัดเฟรมได้ถูกต้อง', () => {
    const { framer, frames } = collect(spec);
    framer.push(fromHex('7E 03 AA BB CC'));
    assert.deepEqual(frames, ['7E 03 AA BB CC']);
  });

  test('รอจนข้อมูลครบตามความยาวที่ประกาศ', () => {
    const { framer, frames } = collect(spec);
    framer.push(fromHex('7E 04 AA BB'));
    assert.deepEqual(frames, []);
    framer.push(fromHex('CC DD'));
    assert.deepEqual(frames, ['7E 04 AA BB CC DD']);
  });

  test('ข้ามไปหา STX ตัวถัดไปเมื่อความยาวเพี้ยน', () => {
    const { framer, frames } = collect({ ...spec, maxLength: 8 } as FramingSpec);
    framer.push(fromHex('7E FF 7E 02 AA BB'));
    assert.deepEqual(frames, ['7E 02 AA BB']);
  });
});

describe('Framer โหมด silence', () => {
  const spec: FramingSpec = { kind: 'silence', silenceMs: 20, maxLength: 64 };

  test('ปิดเฟรมเมื่อบัสเงียบครบเวลา', async () => {
    const { framer, frames } = collect(spec);
    framer.push(fromHex('01 03 02 00 0A'));
    assert.deepEqual(frames, [], 'ยังไม่เงียบครบเวลา');
    await new Promise((r) => setTimeout(r, 40));
    assert.deepEqual(frames, ['01 03 02 00 0A']);
    framer.dispose();
  });
});

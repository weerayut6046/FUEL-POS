import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { ProfileCodec } from '../src/protocol/ProfileCodec.js';
import { fromHex, toHex } from '../src/util/bytes.js';
import { decodeNumber, encodeNumber } from '../src/util/numbers.js';
import {
  computeChecksum,
  crc16Modbus,
  sum8,
  verifyChecksum,
  xor8,
} from '../src/util/checksum.js';
import { loadTemplateProfile as loadTemplate } from './helpers.js';

describe('ตัวช่วยแปลงไบต์', () => {
  test('แปลง hex ไป-กลับได้ตรงกัน', () => {
    const bytes = fromHex('02 01 11 01 13 03');
    assert.equal(toHex(bytes), '02 01 11 01 13 03');
  });

  test('รับ hex ได้หลายรูปแบบ', () => {
    assert.equal(toHex(fromHex('0x02,0x01')), '02 01');
    assert.equal(toHex(fromHex('02-01')), '02 01');
    assert.equal(toHex(fromHex('0201')), '02 01');
  });

  test('ปฏิเสธ hex ที่จำนวนหลักเป็นเลขคี่', () => {
    assert.throws(() => fromHex('021'), /เลขคี่/);
  });
});

describe('การเข้ารหัสตัวเลข', () => {
  test('BCD เข้ารหัส/ถอดรหัสตรงกัน', () => {
    const encoded = encodeNumber(123456, 3, 'bcd');
    assert.equal(toHex(encoded), '12 34 56');
    assert.equal(decodeNumber(encoded, 0, 3, 'bcd'), 123456);
  });

  test('BCD เติมศูนย์ด้านหน้าให้ครบความยาว', () => {
    assert.equal(toHex(encodeNumber(45, 3, 'bcd')), '00 00 45');
  });

  test('BCD ที่มีนิบเบิลเกิน 9 ถือว่าไม่ถูกต้อง', () => {
    assert.throws(() => decodeNumber(fromHex('1A'), 0, 1, 'bcd'), /BCD/);
  });

  test('binary little/big endian', () => {
    assert.equal(toHex(encodeNumber(0x1234, 2, 'u16le')), '34 12');
    assert.equal(toHex(encodeNumber(0x1234, 2, 'u16be')), '12 34');
    assert.equal(decodeNumber(fromHex('34 12'), 0, 2, 'u16le'), 0x1234);
    assert.equal(decodeNumber(fromHex('00 01 86 A0'), 0, 4, 'u32be'), 100000);
  });

  test('ASCII decimal', () => {
    assert.equal(toHex(encodeNumber(1234, 6, 'ascii')), '30 30 31 32 33 34');
    assert.equal(decodeNumber(fromHex('30 30 31 32 33 34'), 0, 6, 'ascii'), 1234);
  });

  test('อ่านนอกขอบเขตเฟรมต้อง throw ไม่ใช่คืนค่าเพี้ยน', () => {
    assert.throws(() => decodeNumber(fromHex('01 02'), 1, 3, 'bcd'), RangeError);
  });
});

describe('checksum', () => {
  test('sum8 และ xor8', () => {
    assert.equal(sum8(fromHex('01 02 03')), 6);
    assert.equal(xor8(fromHex('01 02 03')), 0);
  });

  test('CRC-16/MODBUS ตรงกับค่าอ้างอิงมาตรฐาน', () => {
    // "123456789" → 0x4B37 เป็นค่าทดสอบมาตรฐานของ CRC-16/MODBUS
    const data = Uint8Array.from('123456789', (c) => c.charCodeAt(0));
    assert.equal(crc16Modbus(data), 0x4b37);
  });

  test('CRC-16/CCITT-FALSE ตรงกับค่าอ้างอิงมาตรฐาน', () => {
    const data = Uint8Array.from('123456789', (c) => c.charCodeAt(0));
    assert.equal(computeChecksum('crc16_ccitt_false', data), 0x29b1);
  });

  test('verifyChecksum จับเฟรมที่ถูกแก้ไขได้', () => {
    const spec = { kind: 'sum8' as const, from: 1, to: -2, at: -2, endian: 'le' as const };
    const good = fromHex('02 01 11 01 13 03'); // 01+11+01 = 0x13
    assert.equal(verifyChecksum(good, spec), true);
    const bad = fromHex('02 01 11 02 13 03');
    assert.equal(verifyChecksum(bad, spec), false);
  });
});

describe('ProfileCodec กับแม่แบบ ZB01', () => {
  test('ประกอบเฟรมคำสั่ง status ได้ถูกต้องทั้งเฟรม', async () => {
    const codec = new ProfileCodec(await loadTemplate());
    const frame = codec.buildRequest('status', 1, { nozzle: 1 });
    // STX ADDR CMD NOZ SUM ETX ; SUM = 0x01+0x11+0x01 = 0x13
    assert.equal(toHex(frame), '02 01 11 01 13 03');
  });

  test('address ต่างกันได้ checksum ต่างกัน', async () => {
    const codec = new ProfileCodec(await loadTemplate());
    const frame = codec.buildRequest('status', 2, { nozzle: 1 });
    // address 0x02 ชนกับ STX จึงถูก escape ด้วย 0x10 ตอนออกสาย
    assert.equal(toHex(frame), '02 10 02 11 01 14 03');
    assert.equal(toHex(codec.unescape(frame)), '02 02 11 01 14 03');
  });

  test('byte-stuffing ป้องกันข้อมูลที่ชนกับ ETX ไม่ให้ตัดเฟรมกลางคัน', async () => {
    const codec = new ProfileCodec(await loadTemplate());
    // สถานะ 3 (กำลังจ่าย) มีค่าเท่ากับ ETX พอดี — ต้องถูก escape
    const frame = codec.buildResponse('status', 1, { volume: 0 }, { status: 3, nozzle: 1 });
    assert.equal(toHex(frame).includes('10 03'), true, 'ต้องพบลำดับ escape 10 03');
    // ETX ตัวจริงต้องเป็นไบต์สุดท้ายเท่านั้น
    assert.equal(frame[frame.length - 1], 0x03);
    const decoded = codec.decode(codec.unescape(frame));
    assert.equal(decoded?.raw.status, 3);
  });

  test('preset ยอดเงินแปลงสตางค์เป็นค่าดิบ BCD ถูกต้อง', async () => {
    const codec = new ProfileCodec(await loadTemplate());
    // 500.00 บาท = 50000 สตางค์ → ทศนิยม 2 ตำแหน่ง = 50000 → BCD 05 00 00
    const raw = codec.toRawAmount(50_000);
    assert.equal(raw, 50_000);
    const frame = codec.buildRequest('presetAmount', 1, { nozzle: 1, preset: raw });
    assert.equal(toHex(codec.unescape(frame)).startsWith('02 01 22 01 05 00 00'), true);
    assert.equal(codec.verify(codec.unescape(frame)), true);
  });

  test('ขาดตัวแปรที่จำเป็นต้องแจ้ง error ชัดเจน', async () => {
    const codec = new ProfileCodec(await loadTemplate());
    assert.throws(() => codec.buildRequest('presetAmount', 1, { nozzle: 1 }), /preset/);
  });

  test('ถอดรหัสคำตอบ status แปลงหน่วยเป็นมิลลิลิตร/สตางค์', async () => {
    const codec = new ProfileCodec(await loadTemplate());
    // 12.34 ลิตร, 490.51 บาท, 39.75 บาท/ลิตร, มิเตอร์ 123456.78 ลิตร
    const frame = codec.buildResponse(
      'status',
      1,
      {
        nozzle: 2,
        volume: 12_340,
        amount: 49_051,
        unitPrice: 3975,
        totalizerVolume: 123_456_780,
      },
      { status: 3, nozzle: 2 },
    );

    // Framer ถอด byte-stuffing ให้ก่อนเสมอ ที่นี่จึงถอดเองเพื่อจำลองขั้นตอนนั้น
    const decoded = codec.decode(codec.unescape(frame));
    assert.ok(decoded);
    assert.equal(decoded.name, 'status');
    assert.equal(decoded.address, 1);
    assert.equal(decoded.fields.volume, 12_340);
    assert.equal(decoded.fields.amount, 49_051);
    assert.equal(decoded.fields.unitPrice, 3975);
    assert.equal(decoded.fields.totalizerVolume, 123_456_780);
    assert.equal(decoded.raw.status, 3);
  });

  test('เฟรมที่ checksum ผิดต้องถูกปฏิเสธ', async () => {
    const codec = new ProfileCodec(await loadTemplate());
    const frame = codec.buildRequest('status', 1, { nozzle: 1 });
    const wire = codec.unescape(frame);
    wire[3] = 0x09; // แก้ไบต์ข้อมูลโดยไม่แก้ checksum
    assert.throws(() => codec.decode(wire), /checksum/);
  });

  test('decodeRequest ถอดคำสั่งกลับได้ตรงกับตอนสร้าง', async () => {
    const codec = new ProfileCodec(await loadTemplate());
    const frame = codec.buildRequest('presetVolume', 3, { nozzle: 2, preset: 2000 });
    const parsed = codec.decodeRequest(codec.unescape(frame));
    assert.ok(parsed);
    assert.equal(parsed.name, 'presetVolume');
    assert.equal(parsed.address, 3);
    assert.equal(parsed.vars.nozzle, 2);
    assert.equal(parsed.vars.preset, 2000);
  });

  test('คำสั่งที่โปรไฟล์ไม่รองรับต้องแจ้งชัดเจน', async () => {
    const profile = await loadTemplate();
    profile.requests.setPrice = { unsupported: true, tokens: [], expectResponse: false };
    const codec = new ProfileCodec(profile);
    assert.equal(codec.supports('setPrice'), false);
    assert.throws(() => codec.buildRequest('setPrice', 1, { nozzle: 1, price: 1 }), /ไม่รองรับ/);
  });
});

/// หน่วยตัวเลข — ตรงกับฝั่งเซิร์ฟเวอร์ (apps/cloud-api/src/common/units.ts)
///
///   เงิน  → สตางค์ (int)
///   ลิตร  → มิลลิลิตร (int) ภายในแอป · รับ-ส่งกับ API เป็นสตริง "1234.567"
///   ระดับ → 0.1 มม. (int)
///
/// ไม่ใช้ double กับตัวเลขเงินและลิตรเลย เพื่อไม่ให้ยอดคลาดจากการปัดเศษ
library;

import 'package:intl/intl.dart';

final _litresRe = RegExp(r'^(-)?(\d{1,11})(?:\.(\d{1,3}))?$');
final _mmRe = RegExp(r'^(\d{1,6})(?:\.(\d))?$');
final _bahtRe = RegExp(r'^(\d{1,11})(?:\.(\d{1,2}))?$');

/// "1234.567" → 1234567 (null ถ้ารูปแบบผิด)
int? tryParseLitres(String input) {
  final s = input.trim().replaceAll(',', '');
  final m = _litresRe.firstMatch(s);
  if (m == null) return null;
  final whole = int.parse(m.group(2)!);
  final frac = int.parse((m.group(3) ?? '').padRight(3, '0'));
  final milli = whole * 1000 + frac;
  return m.group(1) != null ? -milli : milli;
}

int parseLitres(String input) {
  final v = tryParseLitres(input);
  if (v == null) throw FormatException('รูปแบบลิตรไม่ถูกต้อง: $input');
  return v;
}

/// 1234567 → "1234.567" (รูปแบบที่ส่งให้ API)
String litresToApi(int milli) {
  final sign = milli < 0 ? '-' : '';
  final abs = milli.abs();
  return '$sign${abs ~/ 1000}.${(abs % 1000).toString().padLeft(3, '0')}';
}

/// "29.50" → 2950 สตางค์
int? tryParseBaht(String input) {
  final s = input.trim().replaceAll(',', '');
  if (s.isEmpty) return 0;
  final m = _bahtRe.firstMatch(s);
  if (m == null) return null;
  return int.parse(m.group(1)!) * 100 + int.parse((m.group(2) ?? '').padRight(2, '0'));
}

/// "125.5" → 1255 (0.1 มม.)
int? tryParseMm(String input) {
  final m = _mmRe.firstMatch(input.trim());
  if (m == null) return null;
  return int.parse(m.group(1)!) * 10 + int.parse(m.group(2) ?? '0');
}

String mmToApi(int deci) => '${deci ~/ 10}.${deci % 10}';

/// ปัดครึ่งขึ้น (ห่างจากศูนย์)
int divRoundHalfUp(int numerator, int denominator) {
  final sign = numerator < 0 ? -1 : 1;
  final abs = numerator.abs();
  return sign * ((abs * 2 + denominator) ~/ (denominator * 2));
}

/// ลิตร × ราคา → สตางค์ ปัดครึ่งขึ้น (สูตรเดียวกับเซิร์ฟเวอร์)
int amountSatang(int litresMilli, int priceSatang) => divRoundHalfUp(litresMilli * priceSatang, 1000);

final _baht = NumberFormat('#,##0.00', 'en_US');
final _litres = NumberFormat('#,##0.00', 'en_US');
final _litres3 = NumberFormat('#,##0.000', 'en_US');
final _int = NumberFormat('#,##0', 'en_US');

/// 123456 → "1,234.56"
String fmtBaht(int satang) {
  final sign = satang < 0 ? '-' : '';
  final abs = satang.abs();
  return '$sign${_int.format(abs ~/ 100)}.${(abs % 100).toString().padLeft(2, '0')}';
}

/// แสดงเงินแบบย่อสำหรับการ์ด เช่น 1.25 ล้าน
String fmtBahtShort(int satang) {
  final baht = satang / 100;
  if (baht.abs() >= 1e6) return '${(baht / 1e6).toStringAsFixed(2)} ล้าน';
  return _baht.format(baht);
}

/// มิลลิลิตร → "1,234.57" (แสดงผล 2 ตำแหน่ง)
String fmtLitres(int milli) => _litres.format(milli / 1000);

/// มิลลิลิตร → "1,234.567" (แสดงเลขมิเตอร์เต็ม)
String fmtMeter(int milli) => _litres3.format(milli / 1000);

/// สตริงลิตรจาก API → แสดงผล
String fmtLitresApi(String? v) => v == null ? '-' : fmtLitres(parseLitres(v));

/// ราคา สตางค์/ลิตร → "32.44"
String fmtPrice(int satang) => (satang / 100).toStringAsFixed(2);

/// แปลงระดับเป็นลิตรด้วยตารางแปลง (ตรงกับเซิร์ฟเวอร์) — ใช้แสดงตัวอย่างก่อนบันทึก
int? litresAtLevel(List<({int deciMm, int milli})> points, int deciMm) {
  if (points.isEmpty) return null;
  final first = points.first;
  final last = points.last;
  if (deciMm > last.deciMm) return null;
  var lo = deciMm < first.deciMm ? (deciMm: 0, milli: 0) : first;
  var hi = first;
  if (deciMm >= first.deciMm) {
    if (deciMm == first.deciMm) return first.milli;
    for (var i = 1; i < points.length; i++) {
      if (points[i].deciMm >= deciMm) {
        lo = points[i - 1];
        hi = points[i];
        break;
      }
    }
  }
  if (hi.deciMm == lo.deciMm) return hi.milli;
  return lo.milli + divRoundHalfUp((hi.milli - lo.milli) * (deciMm - lo.deciMm), hi.deciMm - lo.deciMm);
}

List<({int deciMm, int milli})> parseCalibrationPoints(List<dynamic> json) => [
      for (final p in json)
        (deciMm: tryParseMm(p['mm'].toString()) ?? 0, milli: parseLitres(p['litres'].toString())),
    ];

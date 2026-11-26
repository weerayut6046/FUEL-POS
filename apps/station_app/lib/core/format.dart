/// รูปแบบวันที่แบบไทย
library;

import 'package:intl/intl.dart';

const _thaiMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const _thaiDays = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'];

/// "2026-11-26" → "26 พ.ย. 69"
String thaiDate(String isoDate, {bool weekday = false}) {
  final d = DateTime.parse(isoDate);
  final y = (d.year + 543) % 100;
  final base = '${d.day} ${_thaiMonths[d.month - 1]} ${y.toString().padLeft(2, '0')}';
  return weekday ? '${_thaiDays[d.weekday - 1]} $base' : base;
}

/// "2026-11-26" → "26/11"
String shortDate(String isoDate) {
  final d = DateTime.parse(isoDate);
  return '${d.day}/${d.month}';
}

/// เวลาแบบ 14:05
String thaiTime(String isoDateTime) => DateFormat('HH:mm').format(DateTime.parse(isoDateTime).toLocal());

/// "26 พ.ย. 69 14:05"
String thaiDateTime(String isoDateTime) {
  final d = DateTime.parse(isoDateTime).toLocal();
  return '${thaiDate(isoDateOf(d))} ${DateFormat('HH:mm').format(d)}';
}

String isoDateOf(DateTime d) => DateFormat('yyyy-MM-dd').format(d);

String todayIso() => isoDateOf(DateTime.now());

String addDays(String isoDate, int days) => isoDateOf(DateTime.parse(isoDate).add(Duration(days: days)));

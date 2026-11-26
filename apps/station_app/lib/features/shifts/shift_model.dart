/// โมเดลกะที่หน้าจอใช้ = ข้อมูลจากเซิร์ฟเวอร์ (หรือแคช) + รายการที่บันทึกในเครื่องแต่ยังไม่ได้ส่ง
///
/// ทำให้พนักงานเห็นตัวเลขที่เพิ่งกรอกทันที และคำนวณยอด/คำเตือนได้แม้ออฟไลน์
library;

import 'dart:convert';

import '../../core/local_db.dart';
import '../../core/shift_calc.dart';
import '../../core/units.dart';

typedef Json = Map<String, dynamic>;

class ReadingModel {
  const ReadingModel({
    required this.id,
    required this.milli,
    this.rollover = false,
    this.photoId,
    this.pending = false,
    this.byName,
    this.at,
  });

  final String id;
  final int milli;
  final bool rollover;
  final String? photoId;
  final bool pending;
  final String? byName;
  final String? at;
}

class NozzleModel {
  NozzleModel({
    required this.nozzleId,
    required this.code,
    required this.name,
    required this.dispenserNo,
    required this.fuelTypeId,
    required this.tankId,
    required this.priceSatang,
    required this.attendantId,
    required this.modulusMilli,
    this.open,
    this.close,
    this.testMilli = 0,
    this.testId,
    this.prevCloseMilli,
    this.nextOpenMilli,
  });

  final String nozzleId;
  final String code;
  final String name;
  final int dispenserNo;
  final String fuelTypeId;
  final String tankId;
  final int priceSatang;
  String? attendantId;
  final int modulusMilli;
  ReadingModel? open;
  ReadingModel? close;
  int testMilli;
  String? testId;
  bool testPending = false;
  int? prevCloseMilli;
  int? nextOpenMilli;

  bool get done => open != null && close != null;
}

class CollectionModel {
  CollectionModel({required this.id, required this.attendantId, required this.method, required this.amountSatang, this.pending = false});
  final String id;
  final String attendantId;
  final String method;
  final int amountSatang;
  final bool pending;
}

class Staff {
  const Staff(this.id, this.name, this.role);
  final String id;
  final String name;
  final String role;
}

class FuelInfo {
  const FuelInfo(this.id, this.name, this.color);
  final String id;
  final String name;
  final int color;
}

class ShiftModel {
  ShiftModel({
    required this.id,
    required this.branchId,
    required this.businessDate,
    required this.shiftNo,
    required this.status,
    required this.nozzles,
    required this.collections,
    required this.staff,
    required this.fuels,
    required this.cashAlertSatang,
    required this.serverIssues,
    required this.events,
    required this.history,
    this.pendingOpen = false,
    this.pendingSubmit = false,
    this.fromCache = false,
    this.openedByName,
    this.approvedByName,
    this.approvalNote,
    this.note,
  }) {
    calc = _compute();
  }

  final String id;
  final String branchId;
  final String businessDate;
  final int shiftNo;

  /// open · submitted · approved
  final String status;
  final List<NozzleModel> nozzles;
  final List<CollectionModel> collections;
  final List<Staff> staff;
  final Map<String, FuelInfo> fuels;
  final int cashAlertSatang;
  final List<Issue> serverIssues;
  final List<dynamic> events;
  final Json history;
  final bool pendingOpen;
  final bool pendingSubmit;
  final bool fromCache;
  final String? openedByName;
  final String? approvedByName;
  final String? approvalNote;
  final String? note;
  late final ShiftCalc calc;

  Map<String, String> get names => {for (final s in staff) s.id: s.name};
  String nameOf(String? id) => id == null ? 'ไม่ระบุพนักงาน' : (names[id] ?? 'ไม่ทราบชื่อ');

  bool get isOpen => status == 'open' && !pendingSubmit;

  /// คำเตือนจากในเครื่อง + คำเตือนที่รู้ได้เฉพาะฝั่งเซิร์ฟเวอร์ (เช่น เปลี่ยนราคาระหว่างกะ)
  List<Issue> get issues => [
        ...calc.issues,
        ...serverIssues.where((i) => i.code == 'PRICE_CHANGED'),
      ];

  /// พนักงานที่เกี่ยวกับกะนี้ (รับผิดชอบหัวจ่าย หรือมีเงินส่ง)
  List<String?> get attendantIds {
    final ids = <String?>{
      for (final n in nozzles) n.attendantId,
      for (final c in collections) c.attendantId,
    };
    return ids.toList();
  }

  CollectionModel? collection(String attendantId, String method) =>
      collections.where((c) => c.attendantId == attendantId && c.method == method).firstOrNull;

  ShiftCalc _compute() => computeShift(
        [
          for (final n in nozzles)
            LineInput(
              nozzleId: n.nozzleId,
              nozzleCode: n.code,
              fuelTypeId: n.fuelTypeId,
              priceSatang: n.priceSatang,
              attendantId: n.attendantId,
              modulusMilli: n.modulusMilli,
              openMilli: n.open?.milli,
              closeMilli: n.close?.milli,
              rollover: n.close?.rollover ?? false,
              testMilli: n.testMilli,
              openHasPhoto: n.open?.photoId != null,
              closeHasPhoto: n.close?.photoId != null,
              prevCloseMilli: n.prevCloseMilli,
              nextOpenMilli: n.nextOpenMilli,
            ),
        ],
        [for (final c in collections) (attendantId: c.attendantId, method: c.method, amountSatang: c.amountSatang)],
        cashAlertSatang: cashAlertSatang,
        names: names,
      );

  /// ประกอบโมเดลจาก: รายละเอียดกะ (อาจเป็น null) + ตั้งค่าสาขา + รายการรอส่งในเครื่อง
  static ShiftModel? build({
    required String shiftId,
    required Json? detail,
    required Json setup,
    required List<OutboxOp> ops,
    bool fromCache = false,
  }) {
    final pending = ops.where((o) => o.status == 'pending').toList();
    final staff = [
      for (final s in (setup['staff'] as List? ?? const []))
        Staff(s['id'] as String, s['displayName'] as String, s['role'] as String),
    ];
    final fuels = {
      for (final f in (setup['fuelTypes'] as List? ?? const []))
        f['id'] as String: FuelInfo(f['id'] as String, f['name'] as String, _color(f['color'] as String?)),
    };

    final nozzles = <NozzleModel>[];
    final collections = <CollectionModel>[];
    String status;
    String businessDate;
    int shiftNo;
    var pendingOpen = false;

    if (detail != null) {
      final s = detail['shift'] as Json;
      status = s['status'] as String;
      businessDate = s['businessDate'] as String;
      shiftNo = s['shiftNo'] as int;
      for (final n in detail['nozzles'] as List) {
        final m = NozzleModel(
          nozzleId: n['nozzleId'] as String,
          code: n['code'] as String,
          name: n['name'] as String,
          dispenserNo: n['dispenserNo'] as int,
          fuelTypeId: n['fuelTypeId'] as String,
          tankId: n['tankId'] as String,
          priceSatang: n['priceSatang'] as int,
          attendantId: n['attendantId'] as String?,
          modulusMilli: parseLitres(n['meterModulus'] as String),
          open: _reading(n['open']),
          close: _reading(n['close']),
          testMilli: n['test'] == null ? 0 : parseLitres(n['test']['litres'] as String),
          testId: n['test']?['id'] as String?,
          prevCloseMilli: n['prevClose'] == null ? null : parseLitres(n['prevClose'] as String),
          nextOpenMilli: n['nextOpen'] == null ? null : parseLitres(n['nextOpen'] as String),
        );
        nozzles.add(m);
      }
      for (final c in detail['collections'] as List) {
        collections.add(CollectionModel(
          id: c['id'] as String,
          attendantId: c['attendantId'] as String,
          method: c['method'] as String,
          amountSatang: c['amountSatang'] as int,
        ));
      }
    } else {
      // กะที่เปิดในเครื่องแต่ยังไม่ถึงเซิร์ฟเวอร์ → สร้างจากตั้งค่าสาขาที่เก็บไว้
      final openOp = pending.where((o) => o.kind == 'openShift').firstOrNull;
      if (openOp == null) return null;
      final body = jsonDecode(openOp.body!) as Json;
      pendingOpen = true;
      status = 'open';
      businessDate = body['businessDate'] as String;
      shiftNo = body['shiftNo'] as int;
      final prices = {for (final p in setup['prices'] as List) p['fuelTypeId'] as String: p['priceSatang'] as int};
      final lastClose = {
        for (final r in (setup['lastCloseReadings'] as List? ?? const [])) r['nozzleId'] as String: parseLitres(r['reading'] as String),
      };
      for (final n in setup['nozzles'] as List) {
        nozzles.add(NozzleModel(
          nozzleId: n['id'] as String,
          code: n['code'] as String,
          name: n['name'] as String,
          dispenserNo: n['dispenserNo'] as int,
          fuelTypeId: n['fuelTypeId'] as String,
          tankId: n['tankId'] as String,
          priceSatang: prices[n['fuelTypeId']] ?? 0,
          attendantId: body['attendantId'] as String?,
          modulusMilli: parseLitres(n['meterModulus'] as String),
          prevCloseMilli: lastClose[n['id']],
        ));
      }
    }

    var pendingSubmit = false;
    for (final op in pending) {
      final body = op.body == null ? <String, dynamic>{} : jsonDecode(op.body!) as Json;
      switch (op.kind) {
        case 'reading':
          final n = nozzles.where((x) => x.nozzleId == body['nozzleId']).firstOrNull;
          if (n == null) break;
          final r = ReadingModel(
            id: body['id'] as String,
            milli: parseLitres(body['reading'] as String),
            rollover: body['rollover'] as bool? ?? false,
            photoId: body['photoId'] as String?,
            pending: true,
            byName: 'รอส่ง',
          );
          if (body['kind'] == 'open') {
            n.open = r;
          } else {
            n.close = r;
          }
        case 'pumpTest':
          final n = nozzles.where((x) => x.nozzleId == body['nozzleId']).firstOrNull;
          if (n == null) break;
          n.testMilli = parseLitres(body['litres'] as String);
          n.testId = body['id'] as String;
          n.testPending = true;
        case 'collection':
          collections.removeWhere((c) => c.attendantId == body['attendantId'] && c.method == body['method']);
          collections.add(CollectionModel(
            id: body['id'] as String,
            attendantId: body['attendantId'] as String,
            method: body['method'] as String,
            amountSatang: body['amountSatang'] as int,
            pending: true,
          ));
        case 'attendant':
          final nozzleId = op.path.split('/').reversed.elementAt(1);
          final n = nozzles.where((x) => x.nozzleId == nozzleId).firstOrNull;
          n?.attendantId = body['attendantId'] as String?;
        case 'submit':
          pendingSubmit = true;
      }
    }

    final s = detail?['shift'] as Json?;
    return ShiftModel(
      id: shiftId,
      branchId: (s?['branchId'] ?? (setup['branch'] as Json)['id']) as String,
      businessDate: businessDate,
      shiftNo: shiftNo,
      status: status,
      nozzles: nozzles,
      collections: collections,
      staff: staff,
      fuels: fuels,
      cashAlertSatang: setup['cashAlertSatang'] as int? ?? 10000,
      serverIssues: [for (final i in (detail?['issues'] as List? ?? const [])) Issue.fromJson(i as Json)],
      events: detail?['events'] as List? ?? const [],
      history: detail?['history'] as Json? ?? const {},
      pendingOpen: pendingOpen,
      pendingSubmit: pendingSubmit,
      fromCache: fromCache,
      openedByName: s?['openedByName'] as String?,
      approvedByName: s?['approvedByName'] as String?,
      approvalNote: s?['approvalNote'] as String?,
      note: s?['note'] as String?,
    );
  }

  static ReadingModel? _reading(dynamic r) => r == null
      ? null
      : ReadingModel(
          id: r['id'] as String,
          milli: parseLitres(r['reading'] as String),
          rollover: r['rollover'] as bool? ?? false,
          photoId: r['photoId'] as String?,
          byName: r['recordedByName'] as String?,
          at: r['recordedAt'] as String?,
        );

  static int _color(String? hex) {
    if (hex == null || hex.length != 7) return 0xFF1565C0;
    return int.parse('FF${hex.substring(1)}', radix: 16);
  }
}

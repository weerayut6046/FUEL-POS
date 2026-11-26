/// ฐานข้อมูลในเครื่อง (SQLite ผ่าน drift)
///
/// - kv_entries: เก็บข้อมูลล่าสุดจากเซิร์ฟเวอร์ (ตั้งค่าสาขา กะ ตารางแปลงถัง) ไว้ดูตอนออฟไลน์
/// - outbox_ops: คิวรายการที่บันทึกในเครื่องแล้วรอส่งขึ้นระบบ (รวมรูปถ่าย)
///   ทุกรายการมี id ที่สร้างในเครื่อง ส่งซ้ำได้ เซิร์ฟเวอร์ไม่สร้างรายการซ้ำ
library;

import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';

part 'local_db.g.dart';

class KvEntries extends Table {
  TextColumn get key => text()();
  TextColumn get value => text()();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column> get primaryKey => {key};
}

class OutboxOps extends Table {
  IntColumn get seq => integer().autoIncrement()();

  /// id ของรายการ (UUID เดียวกับที่ส่งให้ API)
  TextColumn get opId => text()();

  /// ประเภท: openShift reading pumpTest collection attendant submit photo dip delivery
  TextColumn get kind => text()();
  TextColumn get method => text()();
  TextColumn get path => text()();
  TextColumn get body => text().nullable()();
  BlobColumn get bytes => blob().nullable()();
  TextColumn get contentType => text().nullable()();

  /// ใช้กรองรายการรอส่งของกะ/ถังนั้น ๆ เช่น `shift:<id>`
  TextColumn get scope => text().nullable()();

  /// คำอธิบายภาษาไทยให้ผู้ใช้อ่าน
  TextColumn get label => text()();

  /// pending = รอส่ง · failed = เซิร์ฟเวอร์ปฏิเสธ ต้องให้ผู้ใช้ดู
  TextColumn get status => text().withDefault(const Constant('pending'))();
  IntColumn get attempts => integer().withDefault(const Constant(0))();
  TextColumn get lastError => text().nullable()();
  DateTimeColumn get createdAt => dateTime()();
}

@DriftDatabase(tables: [KvEntries, OutboxOps])
class LocalDb extends _$LocalDb {
  LocalDb(super.executor);

  factory LocalDb.open() => LocalDb(
        driftDatabase(
          name: 'fuel_station',
          web: DriftWebOptions(sqlite3Wasm: Uri.parse('sqlite3.wasm'), driftWorker: Uri.parse('drift_worker.js')),
        ),
      );

  @override
  int get schemaVersion => 1;

  // ------------------------------------------------------------------ cache

  Future<void> putJson(String key, Object? value) => into(kvEntries).insertOnConflictUpdate(
        KvEntriesCompanion.insert(key: key, value: jsonEncode(value), updatedAt: DateTime.now()),
      );

  Future<T?> getJson<T>(String key) async {
    final row = await (select(kvEntries)..where((t) => t.key.equals(key))).getSingleOrNull();
    return row == null ? null : jsonDecode(row.value) as T;
  }

  Future<DateTime?> cachedAt(String key) async =>
      (await (select(kvEntries)..where((t) => t.key.equals(key))).getSingleOrNull())?.updatedAt;

  Future<void> deleteKey(String key) => (delete(kvEntries)..where((t) => t.key.equals(key))).go();

  // ------------------------------------------------------------------ outbox

  Future<int> enqueue(OutboxOpsCompanion op) => into(outboxOps).insert(op);

  Future<OutboxOp?> nextPending() => (select(outboxOps)
        ..where((t) => t.status.equals('pending'))
        ..orderBy([(t) => OrderingTerm.asc(t.seq)])
        ..limit(1))
      .getSingleOrNull();

  Future<List<OutboxOp>> opsForScope(String scope) => (select(outboxOps)
        ..where((t) => t.scope.equals(scope))
        ..orderBy([(t) => OrderingTerm.asc(t.seq)]))
      .get();

  Future<List<OutboxOp>> allOps() => (select(outboxOps)..orderBy([(t) => OrderingTerm.asc(t.seq)])).get();

  Stream<List<OutboxOp>> watchOps() => (select(outboxOps)..orderBy([(t) => OrderingTerm.asc(t.seq)])).watch();

  Future<void> removeOp(int seq) => (delete(outboxOps)..where((t) => t.seq.equals(seq))).go();

  Future<void> markFailed(int seq, String error) => (update(outboxOps)..where((t) => t.seq.equals(seq))).write(
        OutboxOpsCompanion(status: const Value('failed'), lastError: Value(error)),
      );

  Future<void> markAttempt(int seq, String error) async {
    final op = await (select(outboxOps)..where((t) => t.seq.equals(seq))).getSingle();
    await (update(outboxOps)..where((t) => t.seq.equals(seq))).write(
      OutboxOpsCompanion(attempts: Value(op.attempts + 1), lastError: Value(error)),
    );
  }

  Future<void> retryFailed() => (update(outboxOps)..where((t) => t.status.equals('failed'))).write(
        const OutboxOpsCompanion(status: Value('pending'), lastError: Value(null)),
      );

  /// แทนที่รายการที่ยังไม่ได้ส่ง (แก้ตัวเลขก่อนส่งขึ้นระบบ — ไม่มีใครเห็นค่าเดิม)
  Future<void> replacePending(String opId, String body) =>
      (update(outboxOps)..where((t) => t.opId.equals(opId) & t.status.equals('pending'))).write(
        OutboxOpsCompanion(body: Value(body)),
      );

  Future<void> clearAll() async {
    await delete(kvEntries).go();
    await delete(outboxOps).go();
  }
}

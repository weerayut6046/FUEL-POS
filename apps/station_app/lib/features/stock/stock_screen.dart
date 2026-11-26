import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/format.dart';
import '../../core/responsive.dart';
import '../../core/session.dart';
import '../../core/sync.dart';
import '../../core/units.dart';
import '../../widgets/common.dart';
import '../data.dart';

class StockScreen extends ConsumerWidget {
  const StockScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider)!;
    return DefaultTabController(
      length: 3,
      child: Column(
        children: [
          const TabBar(tabs: [Tab(text: 'ถังน้ำมัน'), Tab(text: 'รับน้ำมัน'), Tab(text: 'เทียบยอด')]),
          Expanded(
            child: TabBarView(
              children: [
                _TanksTab(branchId: session.branchId!),
                _DeliveriesTab(branchId: session.branchId!, canRecord: session.isManager),
                _ReconTab(branchId: session.branchId!),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// ถัง: สถานะ + วัดถัง
// ---------------------------------------------------------------------------

class _TanksTab extends ConsumerWidget {
  const _TanksTab({required this.branchId});
  final String branchId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(tankStatusProvider(branchId));
    final setup = ref.watch(setupProvider(branchId)).value?.data;
    final ops = ref.watch(outboxProvider).value ?? const [];
    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(tankStatusProvider(branchId)),
      child: AsyncBody(
        value: status,
        onRetry: () => ref.invalidate(tankStatusProvider(branchId)),
        builder: (fetched) {
          final tanks = fetched.data.cast<Map<String, dynamic>>();
          final fuels = {for (final f in (setup?['fuelTypes'] as List? ?? const [])) f['id']: f};
          return LayoutBuilder(builder: (context, c) {
            final cols = c.maxWidth > 1100 ? 3 : (c.maxWidth > 640 ? 2 : 1);
            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                CacheBanner(fetched: fetched),
                const Text('วัดถังทุกวันหลังปิดกะสุดท้าย ระบบแปลงระดับเป็นลิตรด้วยตารางของแต่ละถัง แล้วเทียบกับยอดตามบัญชี'),
                const SizedBox(height: 12),
                if (tanks.isEmpty) const Text('ยังไม่ได้ตั้งค่าถัง (ไปที่ ตั้งค่า → ถังและตารางแปลง)'),
                Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  children: [
                    for (final t in tanks)
                      SizedBox(
                        width: (c.maxWidth - 32 - (cols - 1) * 12) / cols,
                        child: _TankCard(
                          tank: t,
                          fuel: fuels[t['fuelTypeId']] as Map<String, dynamic>?,
                          pendingDips: ops.where((o) => o.scope == 'tank:${t['tankId']}' && o.status == 'pending').length,
                          onDip: () => showDialog<void>(
                            context: context,
                            builder: (_) => _DipDialog(branchId: branchId, tank: t, setup: setup),
                          ),
                        ),
                      ),
                  ],
                ),
              ],
            );
          });
        },
      ),
    );
  }
}

class _TankCard extends StatelessWidget {
  const _TankCard({required this.tank, required this.fuel, required this.pendingDips, required this.onDip});
  final Map<String, dynamic> tank;
  final Map<String, dynamic>? fuel;
  final int pendingDips;
  final VoidCallback onDip;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final pct = double.tryParse(tank['fillPercent'] as String? ?? '') ?? 0;
    final low = tank['belowReorder'] == true;
    final v = tank['lastVariance'] as Map<String, dynamic>?;
    final color = _hex(fuel?['color'] as String?);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(width: 12, height: 40, decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(4))),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(tank['name'] as String, style: theme.textTheme.titleMedium),
                      Text(fuel?['name'] as String? ?? '', style: theme.textTheme.bodySmall),
                    ],
                  ),
                ),
                if (low) Chip(label: const Text('ถึงจุดสั่ง'), backgroundColor: theme.colorScheme.errorContainer, visualDensity: VisualDensity.compact),
              ],
            ),
            const SizedBox(height: 16),
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: LinearProgressIndicator(
                value: (pct / 100).clamp(0, 1),
                minHeight: 14,
                color: low ? theme.colorScheme.error : color,
                backgroundColor: theme.colorScheme.surfaceContainerHighest,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              tank['bookLitres'] == null ? 'ยังไม่เคยวัดถัง' : 'คงเหลือ ~${fmtLitresApi(tank['bookLitres'] as String)} ลิตร (${tank['fillPercent']}%)',
              style: theme.textTheme.titleSmall,
            ),
            Text('ความจุ ${fmtLitresApi(tank['capacityLitres'] as String)} · จุดสั่ง ${fmtLitresApi(tank['reorderLitres'] as String)}', style: theme.textTheme.bodySmall),
            if (tank['lastDipDate'] != null)
              Text('วัดล่าสุด ${thaiDate(tank['lastDipDate'] as String)}: ${fmtLitresApi(tank['lastDipLitres'] as String)} ลิตร', style: theme.textTheme.bodySmall),
            if (v != null) ...[
              const SizedBox(height: 4),
              _VarianceText(v),
            ],
            if (pendingDips > 0) Text('รอส่ง $pendingDips รายการ', style: TextStyle(color: Colors.orange.shade800)),
            const SizedBox(height: 12),
            FilledButton.tonalIcon(onPressed: onDip, icon: const Icon(Icons.straighten), label: const Text('วัดถัง')),
          ],
        ),
      ),
    );
  }
}

class _VarianceText extends StatelessWidget {
  const _VarianceText(this.v);
  final Map<String, dynamic> v;

  @override
  Widget build(BuildContext context) {
    final milli = parseLitres(v['varianceLitres'] as String);
    final color = milli < 0 ? Theme.of(context).colorScheme.error : Colors.green.shade700;
    return Text(
      'วันที่ ${thaiDate(v['date'] as String)}: ${milli < 0 ? 'ขาด' : 'เกิน'} ${fmtLitres(milli.abs())} ลิตร'
      '${v['variancePercent'] == null ? '' : ' (${v['variancePercent']}% ของยอดขาย)'}',
      style: TextStyle(color: milli == 0 ? null : color, fontWeight: FontWeight.w600),
    );
  }
}

Color _hex(String? hex) => hex == null || hex.length != 7 ? Colors.blueGrey : Color(int.parse('FF${hex.substring(1)}', radix: 16));

Future<Uint8List?> _pickPhoto() async {
  final picker = ImagePicker();
  final source = picker.supportsImageSource(ImageSource.camera) ? ImageSource.camera : ImageSource.gallery;
  final f = await picker.pickImage(source: source, maxWidth: 1600, maxHeight: 1600, imageQuality: 70);
  return f?.readAsBytes();
}

class _DipDialog extends ConsumerStatefulWidget {
  const _DipDialog({required this.branchId, required this.tank, required this.setup});
  final String branchId;
  final Map<String, dynamic> tank;
  final Map<String, dynamic>? setup;

  @override
  ConsumerState<_DipDialog> createState() => _DipDialogState();
}

class _DipDialogState extends ConsumerState<_DipDialog> {
  final _level = TextEditingController();
  final _water = TextEditingController();
  late String _date = (widget.setup?['today'] as String?) ?? todayIso();
  Uint8List? _photo;

  List<({int deciMm, int milli})> get _points {
    final cal = (widget.setup?['calibrations'] as Map?)?[widget.tank['tankId']] as Map?;
    return cal == null ? const [] : parseCalibrationPoints(cal['points'] as List);
  }

  int? get _preview {
    final level = tryParseMm(_level.text);
    if (level == null) return null;
    final water = tryParseMm(_water.text.isEmpty ? '0' : _water.text) ?? 0;
    final a = litresAtLevel(_points, level);
    final b = water == 0 ? 0 : litresAtLevel(_points, water);
    if (a == null || b == null) return null;
    return a - b;
  }

  @override
  void dispose() {
    _level.dispose();
    _water.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final level = tryParseMm(_level.text);
    final water = tryParseMm(_water.text.isEmpty ? '0' : _water.text);
    if (level == null || water == null) {
      showMessage(context, 'กรอกระดับเป็นมิลลิเมตร (ทศนิยม 1 ตำแหน่ง)', error: true);
      return;
    }
    if (_points.isNotEmpty && litresAtLevel(_points, level) == null) {
      showMessage(context, 'ระดับสูงกว่าตารางแปลงของถังนี้', error: true);
      return;
    }
    String? reason;
    if (widget.tank['lastDipDate'] == _date) {
      reason = await askReason(context, title: 'วันนี้วัดถังนี้แล้ว — เหตุผลที่วัดใหม่');
      if (reason == null) return;
    }
    final sync = ref.read(syncProvider.notifier);
    final tankId = widget.tank['tankId'] as String;
    String? photoId;
    if (_photo != null) {
      photoId = newId();
      await sync.enqueue(
        opId: photoId,
        kind: 'photo',
        method: 'PUT',
        path: '/photos/$photoId',
        bytes: _photo,
        contentType: 'image/jpeg',
        scope: 'tank:$tankId',
        label: 'รูปวัดถัง ${widget.tank['name']}',
      );
    }
    final id = newId();
    await sync.enqueue(
      opId: id,
      kind: 'dip',
      method: 'POST',
      path: '/tanks/$tankId/dips',
      body: {
        'id': id,
        'businessDate': _date,
        'levelMm': mmToApi(level),
        'waterMm': mmToApi(water),
        'photoId': photoId,
        'reason': reason,
        'measuredAt': DateTime.now().toUtc().toIso8601String(),
        'deviceAt': DateTime.now().toUtc().toIso8601String(),
      },
      scope: 'tank:$tankId',
      label: 'วัดถัง ${widget.tank['name']} ${mmToApi(level)} มม.',
    );
    if (mounted) {
      Navigator.pop(context);
      showMessage(context, 'บันทึกการวัดถังแล้ว');
    }
  }

  @override
  Widget build(BuildContext context) {
    final preview = _preview;
    return AlertDialog(
      title: Text('วัดถัง · ${widget.tank['name']}'),
      content: SizedBox(
        width: 400,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.event),
                title: const Text('วันที่ทำการ'),
                subtitle: Text(thaiDate(_date, weekday: true)),
                onTap: () async {
                  final d = await showDatePicker(
                    context: context,
                    initialDate: DateTime.parse(_date),
                    firstDate: DateTime.parse(_date).subtract(const Duration(days: 14)),
                    lastDate: DateTime.parse(_date).add(const Duration(days: 1)),
                  );
                  if (d != null) setState(() => _date = isoDateOf(d));
                },
              ),
              DecimalField(controller: _level, label: 'ระดับน้ำมัน', decimals: 1, suffix: 'มม.', big: true, autofocus: true, onChanged: (_) => setState(() {})),
              const SizedBox(height: 12),
              DecimalField(controller: _water, label: 'ระดับน้ำก้นถัง (ถ้ามี)', decimals: 1, suffix: 'มม.', onChanged: (_) => setState(() {})),
              const SizedBox(height: 16),
              if (_points.isEmpty)
                const Text('ถังนี้ยังไม่มีตารางแปลง — ระบบจะปฏิเสธการบันทึก')
              else
                Text(
                  preview == null ? 'ปริมาณ: -' : 'ปริมาณน้ำมัน ≈ ${fmtLitres(preview)} ลิตร',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              const SizedBox(height: 12),
              Row(
                children: [
                  if (_photo != null) ClipRRect(borderRadius: BorderRadius.circular(8), child: Image.memory(_photo!, width: 56, height: 56, fit: BoxFit.cover)),
                  const SizedBox(width: 8),
                  OutlinedButton.icon(
                    onPressed: () async {
                      final p = await _pickPhoto();
                      if (p != null) setState(() => _photo = p);
                    },
                    icon: const Icon(Icons.photo_camera_outlined),
                    label: const Text('ถ่ายรูปไม้วัด'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('ยกเลิก')),
        FilledButton(onPressed: _save, child: const Text('บันทึก')),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// รับน้ำมัน
// ---------------------------------------------------------------------------

class _DeliveriesTab extends ConsumerWidget {
  const _DeliveriesTab({required this.branchId, required this.canRecord});
  final String branchId;
  final bool canRecord;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final to = todayIso();
    final args = RangeArgs(branchId, addDays(to, -30), addDays(to, 1));
    final list = ref.watch(deliveriesProvider(args));
    final setup = ref.watch(setupProvider(branchId)).value?.data;
    final tankNames = {for (final t in (setup?['tanks'] as List? ?? const [])) t['id']: t['name']};
    return Scaffold(
      floatingActionButton: canRecord
          ? FloatingActionButton.extended(
              onPressed: setup == null ? null : () => showDialog<void>(context: context, builder: (_) => _DeliveryDialog(setup: setup)),
              icon: const Icon(Icons.local_shipping),
              label: const Text('รับน้ำมัน'),
            )
          : null,
      body: AsyncBody(
        value: list,
        onRetry: () => ref.invalidate(deliveriesProvider(args)),
        builder: (fetched) {
          final rows = fetched.data.cast<Map<String, dynamic>>().where((d) => d['current'] == true).toList();
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
            children: [
              CacheBanner(fetched: fetched),
              Text('รับน้ำมัน 30 วันล่าสุด', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              if (rows.isEmpty) const Padding(padding: EdgeInsets.all(24), child: Center(child: Text('ยังไม่มีรายการ'))),
              for (final d in rows)
                Card(
                  margin: const EdgeInsets.only(bottom: 8),
                  child: ListTile(
                    leading: Icon(d['voided'] == true ? Icons.block : Icons.local_shipping_outlined),
                    title: Text(
                      '${tankNames[d['tankId']] ?? 'ถัง'} · ${fmtLitresApi(d['invoiceLitres'] as String)} ลิตร',
                      style: d['voided'] == true ? const TextStyle(decoration: TextDecoration.lineThrough) : null,
                    ),
                    subtitle: Text([
                      thaiDate(d['businessDate'] as String),
                      if (d['documentNo'] != null) 'ใบส่ง ${d['documentNo']}',
                      if (d['supplier'] != null) d['supplier'],
                      if (d['receivedDiffLitres'] != null) 'วัดได้ต่างจากใบส่ง ${fmtLitresApi(d['receivedDiffLitres'] as String)} ลิตร',
                      if (d['voided'] == true) 'ยกเลิก: ${d['reason']}',
                    ].join(' · ')),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

class _DeliveryDialog extends ConsumerStatefulWidget {
  const _DeliveryDialog({required this.setup});
  final Map<String, dynamic> setup;

  @override
  ConsumerState<_DeliveryDialog> createState() => _DeliveryDialogState();
}

class _DeliveryDialogState extends ConsumerState<_DeliveryDialog> {
  String? _tankId;
  late String _date = (widget.setup['today'] as String?) ?? todayIso();
  final _doc = TextEditingController();
  final _supplier = TextEditingController();
  final _litres = TextEditingController();
  final _before = TextEditingController();
  final _after = TextEditingController();
  Uint8List? _photo;

  @override
  void dispose() {
    for (final c in [_doc, _supplier, _litres, _before, _after]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    final litres = tryParseLitres(_litres.text);
    if (_tankId == null || litres == null || litres <= 0) {
      showMessage(context, 'เลือกถังและกรอกลิตรตามใบส่ง', error: true);
      return;
    }
    final before = _before.text.isEmpty ? null : tryParseMm(_before.text);
    final after = _after.text.isEmpty ? null : tryParseMm(_after.text);
    final sync = ref.read(syncProvider.notifier);
    String? photoId;
    if (_photo != null) {
      photoId = newId();
      await sync.enqueue(
        opId: photoId,
        kind: 'photo',
        method: 'PUT',
        path: '/photos/$photoId',
        bytes: _photo,
        contentType: 'image/jpeg',
        scope: 'tank:$_tankId',
        label: 'รูปใบส่งน้ำมัน',
      );
    }
    final id = newId();
    await sync.enqueue(
      opId: id,
      kind: 'delivery',
      method: 'POST',
      path: '/deliveries',
      body: {
        'id': id,
        'tankId': _tankId,
        'businessDate': _date,
        'deliveredAt': DateTime.now().toUtc().toIso8601String(),
        'documentNo': _doc.text.trim().isEmpty ? null : _doc.text.trim(),
        'supplier': _supplier.text.trim().isEmpty ? null : _supplier.text.trim(),
        'invoiceLitres': litresToApi(litres),
        'dipBeforeMm': before == null ? null : mmToApi(before),
        'dipAfterMm': after == null ? null : mmToApi(after),
        'photoId': photoId,
        'deviceAt': DateTime.now().toUtc().toIso8601String(),
      },
      scope: 'tank:$_tankId',
      label: 'รับน้ำมัน ${litresToApi(litres)} ลิตร',
    );
    if (mounted) {
      Navigator.pop(context);
      showMessage(context, 'บันทึกรับน้ำมันแล้ว');
    }
  }

  @override
  Widget build(BuildContext context) {
    final tanks = (widget.setup['tanks'] as List).cast<Map<String, dynamic>>();
    return AlertDialog(
      title: const Text('รับน้ำมันจากรถส่ง'),
      content: SizedBox(
        width: 440,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              DropdownButtonFormField<String>(
                initialValue: _tankId,
                decoration: const InputDecoration(labelText: 'ถัง'),
                items: [for (final t in tanks) DropdownMenuItem(value: t['id'] as String, child: Text(t['name'] as String))],
                onChanged: (v) => setState(() => _tankId = v),
              ),
              const SizedBox(height: 12),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.event),
                title: const Text('วันที่ทำการ'),
                subtitle: Text(thaiDate(_date)),
                onTap: () async {
                  final d = await showDatePicker(
                    context: context,
                    initialDate: DateTime.parse(_date),
                    firstDate: DateTime.parse(_date).subtract(const Duration(days: 14)),
                    lastDate: DateTime.parse(_date).add(const Duration(days: 1)),
                  );
                  if (d != null) setState(() => _date = isoDateOf(d));
                },
              ),
              DecimalField(controller: _litres, label: 'ลิตรตามใบส่ง', suffix: 'ลิตร', big: true),
              const SizedBox(height: 12),
              TextField(controller: _doc, decoration: const InputDecoration(labelText: 'เลขที่ใบส่งของ')),
              const SizedBox(height: 12),
              TextField(controller: _supplier, decoration: const InputDecoration(labelText: 'ผู้ส่ง/คลัง')),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(child: DecimalField(controller: _before, label: 'วัดก่อนรับ', decimals: 1, suffix: 'มม.')),
                  const SizedBox(width: 12),
                  Expanded(child: DecimalField(controller: _after, label: 'วัดหลังรับ', decimals: 1, suffix: 'มม.')),
                ],
              ),
              const SizedBox(height: 4),
              const Text('ถ้าวัดก่อน/หลัง ระบบจะคำนวณว่าได้น้ำมันจริงครบตามใบส่งไหม', style: TextStyle(fontSize: 12)),
              const SizedBox(height: 12),
              Row(
                children: [
                  if (_photo != null) ClipRRect(borderRadius: BorderRadius.circular(8), child: Image.memory(_photo!, width: 56, height: 56, fit: BoxFit.cover)),
                  const SizedBox(width: 8),
                  OutlinedButton.icon(
                    onPressed: () async {
                      final p = await _pickPhoto();
                      if (p != null) setState(() => _photo = p);
                    },
                    icon: const Icon(Icons.receipt_long),
                    label: const Text('ถ่ายรูปใบส่ง'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('ยกเลิก')),
        FilledButton(onPressed: _save, child: const Text('บันทึก')),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// เทียบยอดตามบัญชี vs วัดจริง
// ---------------------------------------------------------------------------

class _ReconTab extends ConsumerStatefulWidget {
  const _ReconTab({required this.branchId});
  final String branchId;

  @override
  ConsumerState<_ReconTab> createState() => _ReconTabState();
}

class _ReconTabState extends ConsumerState<_ReconTab> {
  int _days = 7;

  @override
  Widget build(BuildContext context) {
    final to = todayIso();
    final args = RangeArgs(widget.branchId, addDays(to, -_days), to);
    final recon = ref.watch(reconciliationProvider(args));
    return AsyncBody(
      value: recon,
      onRetry: () => ref.invalidate(reconciliationProvider(args)),
      builder: (fetched) {
        final tanks = (fetched.data['tanks'] as List).cast<Map<String, dynamic>>();
        final openDates = (fetched.data['openShiftDates'] as List).cast<String>();
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            CacheBanner(fetched: fetched),
            Row(
              children: [
                const Expanded(child: Text('ยอดตามบัญชี = วัดครั้งก่อน + รับเข้า − ขาย (จากมิเตอร์)\nขาด/เกิน = วัดจริง − ตามบัญชี')),
                SegmentedButton<int>(
                  segments: const [ButtonSegment(value: 7, label: Text('7 วัน')), ButtonSegment(value: 30, label: Text('30 วัน'))],
                  selected: {_days},
                  onSelectionChanged: (v) => setState(() => _days = v.first),
                ),
              ],
            ),
            if (openDates.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text('มีกะที่ยังไม่ปิดในวันที่ ${openDates.map(thaiDate).join(', ')} — ยอดขายของวันนั้นยังไม่ครบ',
                    style: TextStyle(color: Colors.orange.shade800)),
              ),
            for (final t in tanks) ...[
              SectionTitle(t['name'] as String),
              if ((t['rows'] as List).isEmpty)
                const Text('ต้องมีการวัดถังอย่างน้อย 2 วันจึงจะเทียบยอดได้')
              else
                Card(
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: DataTable(
                      columnSpacing: context.isCompact ? 16 : 28,
                      columns: const [
                        DataColumn(label: Text('วันที่')),
                        DataColumn(label: Text('ยกมา'), numeric: true),
                        DataColumn(label: Text('+ รับ'), numeric: true),
                        DataColumn(label: Text('− ขาย'), numeric: true),
                        DataColumn(label: Text('ตามบัญชี'), numeric: true),
                        DataColumn(label: Text('วัดจริง'), numeric: true),
                        DataColumn(label: Text('ขาด/เกิน'), numeric: true),
                        DataColumn(label: Text('%'), numeric: true),
                      ],
                      rows: [
                        for (final r in (t['rows'] as List).cast<Map<String, dynamic>>().reversed)
                          DataRow(cells: [
                            DataCell(Text(thaiDate(r['date'] as String))),
                            DataCell(Text(fmtLitresApi(r['openingLitres'] as String))),
                            DataCell(Text(fmtLitresApi(r['deliveriesLitres'] as String))),
                            DataCell(Text(fmtLitresApi(r['salesLitres'] as String))),
                            DataCell(Text(fmtLitresApi(r['bookLitres'] as String))),
                            DataCell(Text(fmtLitresApi(r['actualLitres'] as String))),
                            DataCell(_signed(context, parseLitres(r['varianceLitres'] as String))),
                            DataCell(Text(r['variancePercent'] as String? ?? '-')),
                          ]),
                      ],
                    ),
                  ),
                ),
            ],
          ],
        );
      },
    );
  }

  Widget _signed(BuildContext context, int milli) => Text(
        '${milli > 0 ? '+' : ''}${fmtLitres(milli)}',
        style: TextStyle(color: milli < 0 ? Theme.of(context).colorScheme.error : (milli > 0 ? Colors.green.shade700 : null), fontWeight: FontWeight.w600),
      );
}

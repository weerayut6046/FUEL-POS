/// หน้าตั้งค่า (ต้องออนไลน์ — แก้ตั้งค่าบนเซิร์ฟเวอร์โดยตรง)
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/format.dart';
import '../../core/responsive.dart';
import '../../core/session.dart';
import '../../core/units.dart';
import '../../widgets/common.dart';
import '../data.dart';

typedef Json = Map<String, dynamic>;

class _Page extends StatelessWidget {
  const _Page({required this.title, required this.child, this.fab});
  final String title;
  final Widget child;
  final Widget? fab;

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(title)),
        floatingActionButton: fab,
        body: MaxWidth(width: 900, child: child),
      );
}

/// รีเฟรชข้อมูลที่เกี่ยวข้องหลังแก้ตั้งค่า
void _refresh(WidgetRef ref, List<String> paths, {String? branchId}) {
  for (final p in paths) {
    ref.invalidate(settingsGetProvider(p));
  }
  if (branchId != null) ref.invalidate(setupProvider(branchId));
}

Color _hex(String? hex) => hex == null || hex.length != 7 ? Colors.blueGrey : Color(int.parse('FF${hex.substring(1)}', radix: 16));

// ---------------------------------------------------------------------------
// ราคา
// ---------------------------------------------------------------------------

class PricesPage extends ConsumerWidget {
  const PricesPage({super.key, required this.branchId});
  final String branchId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final prices = ref.watch(settingsGetProvider('/branches/$branchId/prices'));
    final fuels = ref.watch(settingsGetProvider('/fuel-types'));
    return _Page(
      title: 'ราคาน้ำมัน',
      fab: FloatingActionButton.extended(
        onPressed: fuels.value == null
            ? null
            : () => showDialog<void>(
                  context: context,
                  builder: (_) => _SetPricesDialog(branchId: branchId, fuels: (fuels.value as List).cast<Json>(), current: prices.value as Json?),
                ),
        icon: const Icon(Icons.edit),
        label: const Text('ประกาศราคาใหม่'),
      ),
      child: AsyncBody(
        value: prices,
        onRetry: () => ref.invalidate(settingsGetProvider('/branches/$branchId/prices')),
        builder: (p) {
          final data = p as Json;
          final names = {for (final f in (fuels.value as List? ?? const [])) f['id']: f['name']};
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
            children: [
              const SectionTitle('ราคาปัจจุบัน'),
              Card(
                child: Column(children: [
                  for (final c in (data['current'] as List).cast<Json>())
                    ListTile(
                      title: Text(names[c['fuelTypeId']] as String? ?? '-'),
                      subtitle: Text('มีผลตั้งแต่ ${thaiDateTime(c['effectiveAt'] as String)} · โดย ${c['createdByName'] ?? '-'}'),
                      trailing: Text('${fmtPrice(c['priceSatang'] as int)} ฿/ล.', style: Theme.of(context).textTheme.titleMedium),
                    ),
                ]),
              ),
              if ((data['scheduled'] as List).isNotEmpty) ...[
                const SectionTitle('ราคาที่ตั้งล่วงหน้า'),
                Card(
                  child: Column(children: [
                    for (final c in (data['scheduled'] as List).cast<Json>())
                      ListTile(
                        title: Text(names[c['fuelTypeId']] as String? ?? '-'),
                        subtitle: Text('มีผล ${thaiDateTime(c['effectiveAt'] as String)}'),
                        trailing: Text('${fmtPrice(c['priceSatang'] as int)} ฿/ล.'),
                      ),
                  ]),
                ),
              ],
              const SectionTitle('ประวัติราคา'),
              Card(
                child: Column(children: [
                  for (final c in (data['history'] as List).cast<Json>().take(50))
                    ListTile(
                      dense: true,
                      title: Text('${names[c['fuelTypeId']] ?? '-'} · ${fmtPrice(c['priceSatang'] as int)} ฿/ล.'),
                      subtitle: Text('${thaiDateTime(c['effectiveAt'] as String)}${c['note'] == null ? '' : ' · ${c['note']}'}'),
                    ),
                ]),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _SetPricesDialog extends ConsumerStatefulWidget {
  const _SetPricesDialog({required this.branchId, required this.fuels, required this.current});
  final String branchId;
  final List<Json> fuels;
  final Json? current;

  @override
  ConsumerState<_SetPricesDialog> createState() => _SetPricesDialogState();
}

class _SetPricesDialogState extends ConsumerState<_SetPricesDialog> {
  late final Map<String, TextEditingController> _ctrls = {
    for (final f in widget.fuels.where((f) => f['active'] == true)) f['id'] as String: TextEditingController(text: _cur(f['id'] as String)),
  };
  final _note = TextEditingController();
  DateTime? _at;

  String _cur(String fuelId) {
    final c = (widget.current?['current'] as List? ?? const []).cast<Json>().where((x) => x['fuelTypeId'] == fuelId).firstOrNull;
    return c == null ? '' : fmtPrice(c['priceSatang'] as int);
  }

  @override
  void dispose() {
    for (final c in _ctrls.values) {
      c.dispose();
    }
    _note.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final items = <Json>[];
    for (final e in _ctrls.entries) {
      if (e.value.text.trim().isEmpty || e.value.text == _cur(e.key)) continue;
      final v = tryParseBaht(e.value.text);
      if (v == null || v <= 0) {
        showMessage(context, 'ราคาไม่ถูกต้อง', error: true);
        return;
      }
      items.add({'fuelTypeId': e.key, 'priceSatang': v});
    }
    if (items.isEmpty) {
      Navigator.pop(context);
      return;
    }
    final ok = await runApi(
      context,
      () => ref.read(apiProvider).post<dynamic>('/branches/${widget.branchId}/prices', {
        'items': items,
        'effectiveAt': _at?.toUtc().toIso8601String(),
        'note': _note.text.trim().isEmpty ? null : _note.text.trim(),
      }),
      success: 'ประกาศราคาแล้ว',
    );
    if (ok && mounted) {
      _refresh(ref, ['/branches/${widget.branchId}/prices'], branchId: widget.branchId);
      Navigator.pop(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('ประกาศราคาใหม่'),
      content: SizedBox(
        width: 400,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              for (final f in widget.fuels.where((f) => _ctrls.containsKey(f['id'])))
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: DecimalField(controller: _ctrls[f['id']]!, label: f['name'] as String, decimals: 2, suffix: '฿/ลิตร'),
                ),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.schedule),
                title: const Text('มีผลเมื่อ'),
                subtitle: Text(_at == null ? 'ทันที' : thaiDateTime(_at!.toIso8601String())),
                onTap: () async {
                  final now = DateTime.now();
                  final d = await showDatePicker(context: context, initialDate: now, firstDate: now, lastDate: now.add(const Duration(days: 14)));
                  if (d == null || !context.mounted) return;
                  final t = await showTimePicker(context: context, initialTime: const TimeOfDay(hour: 5, minute: 0));
                  if (t == null) return;
                  setState(() => _at = DateTime(d.year, d.month, d.day, t.hour, t.minute));
                },
              ),
              TextField(controller: _note, decoration: const InputDecoration(labelText: 'หมายเหตุ เช่น ตามประกาศ ปตท.')),
              const SizedBox(height: 8),
              const Text('กะที่เปิดอยู่จะยังคิดราคาเดิม ควรปิดกะ ณ เวลาเปลี่ยนราคา', style: TextStyle(fontSize: 12)),
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
// ถัง + ตารางแปลง
// ---------------------------------------------------------------------------

class TanksPage extends ConsumerWidget {
  const TanksPage({super.key, required this.branchId});
  final String branchId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final path = '/branches/$branchId/tanks';
    final tanks = ref.watch(settingsGetProvider(path));
    final fuels = ref.watch(settingsGetProvider('/fuel-types'));
    final fuelMap = {for (final f in (fuels.value as List? ?? const [])) f['id'] as String: f as Json};
    return _Page(
      title: 'ถังและตารางแปลง',
      fab: FloatingActionButton.extended(
        onPressed: fuels.value == null
            ? null
            : () => showDialog<void>(context: context, builder: (_) => _TankDialog(branchId: branchId, fuels: (fuels.value as List).cast<Json>())),
        icon: const Icon(Icons.add),
        label: const Text('เพิ่มถัง'),
      ),
      child: AsyncBody(
        value: tanks,
        onRetry: () => ref.invalidate(settingsGetProvider(path)),
        builder: (list) => ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
          children: [
            for (final t in (list as List).cast<Json>())
              Card(
                margin: const EdgeInsets.only(bottom: 12),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: CircleAvatar(backgroundColor: _hex(fuelMap[t['fuelTypeId']]?['color'] as String?), child: Text(t['code'] as String, style: const TextStyle(color: Colors.white, fontSize: 12))),
                        title: Text('${t['name']}${t['active'] == true ? '' : ' (ปิดใช้งาน)'}'),
                        subtitle: Text('${fuelMap[t['fuelTypeId']]?['name'] ?? ''} · ความจุ ${fmtLitresApi(t['capacityLitres'] as String)} ล. · จุดสั่ง ${fmtLitresApi(t['reorderLitres'] as String)} ล.'),
                        trailing: IconButton(
                          icon: const Icon(Icons.edit_outlined),
                          onPressed: () => showDialog<void>(
                            context: context,
                            builder: (_) => _TankDialog(branchId: branchId, fuels: (fuels.value as List? ?? const []).cast<Json>(), tank: t),
                          ),
                        ),
                      ),
                      Row(
                        children: [
                          Icon(t['calibration'] == null ? Icons.warning_amber_rounded : Icons.table_chart_outlined,
                              color: t['calibration'] == null ? Colors.orange.shade800 : null, size: 20),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(t['calibration'] == null
                                ? 'ยังไม่มีตารางแปลง — วัดถังไม่ได้'
                                : 'ตารางแปลง ${t['calibration']['rows']} แถว · สูงสุด ${t['calibration']['maxMm']} มม. = ${fmtLitresApi(t['calibration']['maxLitres'] as String?)} ล.'),
                          ),
                          TextButton(
                            onPressed: () => showDialog<void>(context: context, builder: (_) => _CalibrationDialog(branchId: branchId, tank: t)),
                            child: Text(t['calibration'] == null ? 'ใส่ตาราง' : 'อัปเดตตาราง'),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _TankDialog extends ConsumerStatefulWidget {
  const _TankDialog({required this.branchId, required this.fuels, this.tank});
  final String branchId;
  final List<Json> fuels;
  final Json? tank;

  @override
  ConsumerState<_TankDialog> createState() => _TankDialogState();
}

class _TankDialogState extends ConsumerState<_TankDialog> {
  late final _code = TextEditingController(text: widget.tank?['code'] as String?);
  late final _name = TextEditingController(text: widget.tank?['name'] as String?);
  late final _cap = TextEditingController(text: widget.tank?['capacityLitres'] as String?);
  late final _reorder = TextEditingController(text: widget.tank?['reorderLitres'] as String?);
  late String? _fuel = widget.tank?['fuelTypeId'] as String?;
  late bool _active = widget.tank?['active'] as bool? ?? true;

  Future<void> _save() async {
    final cap = tryParseLitres(_cap.text);
    final reorder = _reorder.text.isEmpty ? 0 : tryParseLitres(_reorder.text);
    if (_code.text.trim().isEmpty || _name.text.trim().isEmpty || _fuel == null || cap == null || cap <= 0 || reorder == null) {
      showMessage(context, 'กรอกข้อมูลให้ครบ', error: true);
      return;
    }
    final body = {
      'code': _code.text.trim(),
      'name': _name.text.trim(),
      'fuelTypeId': _fuel,
      'capacityLitres': litresToApi(cap),
      'reorderLitres': litresToApi(reorder),
      if (widget.tank != null) 'active': _active,
    };
    final api = ref.read(apiProvider);
    final ok = await runApi(
      context,
      () => widget.tank == null ? api.post<dynamic>('/branches/${widget.branchId}/tanks', body) : api.patch<dynamic>('/tanks/${widget.tank!['id']}', body),
      success: 'บันทึกถังแล้ว',
    );
    if (ok && mounted) {
      _refresh(ref, ['/branches/${widget.branchId}/tanks'], branchId: widget.branchId);
      Navigator.pop(context);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text(widget.tank == null ? 'เพิ่มถัง' : 'แก้ไขถัง'),
        content: SizedBox(
          width: 400,
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              TextField(controller: _code, decoration: const InputDecoration(labelText: 'รหัสถัง เช่น T1')),
              const SizedBox(height: 12),
              TextField(controller: _name, decoration: const InputDecoration(labelText: 'ชื่อถัง')),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _fuel,
                decoration: const InputDecoration(labelText: 'ชนิดน้ำมัน'),
                items: [for (final f in widget.fuels) DropdownMenuItem(value: f['id'] as String, child: Text(f['name'] as String))],
                onChanged: (v) => setState(() => _fuel = v),
              ),
              const SizedBox(height: 12),
              DecimalField(controller: _cap, label: 'ความจุ', suffix: 'ลิตร'),
              const SizedBox(height: 12),
              DecimalField(controller: _reorder, label: 'จุดสั่ง (เตือนเมื่อต่ำกว่า)', suffix: 'ลิตร'),
              if (widget.tank != null)
                SwitchListTile(contentPadding: EdgeInsets.zero, value: _active, onChanged: (v) => setState(() => _active = v), title: const Text('ใช้งาน')),
            ]),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('ยกเลิก')),
          FilledButton(onPressed: _save, child: const Text('บันทึก')),
        ],
      );
}

/// วางตารางแปลงจาก Excel/CSV: แต่ละบรรทัด "มม., ลิตร"
class _CalibrationDialog extends ConsumerStatefulWidget {
  const _CalibrationDialog({required this.branchId, required this.tank});
  final String branchId;
  final Json tank;

  @override
  ConsumerState<_CalibrationDialog> createState() => _CalibrationDialogState();
}

class _CalibrationDialogState extends ConsumerState<_CalibrationDialog> {
  final _text = TextEditingController();
  final _note = TextEditingController();
  String? _error;
  int _rows = 0;

  @override
  void initState() {
    super.initState();
    ref.read(apiProvider).get<dynamic>('/tanks/${widget.tank['id']}/calibration').then((cal) {
      if (cal is Json && mounted) {
        _text.text = [for (final p in (cal['points'] as List)) '${p['mm']},${p['litres']}'].join('\n');
        _parse();
      }
    }).catchError((_) {});
  }

  List<Json>? _parse() {
    final points = <Json>[];
    var line = 0;
    for (final raw in _text.text.split(RegExp(r'\r?\n'))) {
      line++;
      final s = raw.trim();
      if (s.isEmpty) continue;
      final parts = s.split(RegExp(r'[,\t;]+|\s+')).where((x) => x.isNotEmpty).toList();
      if (parts.length < 2) {
        setState(() => _error = 'บรรทัด $line: ต้องมี 2 ค่า (มม., ลิตร)');
        return null;
      }
      final mm = tryParseMm(parts[0]);
      final litres = tryParseLitres(parts[1]);
      if (mm == null || litres == null) {
        if (points.isEmpty && line == 1) continue; // แถวหัวตาราง
        setState(() => _error = 'บรรทัด $line: ตัวเลขไม่ถูกต้อง');
        return null;
      }
      points.add({'mm': mmToApi(mm), 'litres': litresToApi(litres)});
    }
    setState(() {
      _error = points.length < 2 ? 'ต้องมีอย่างน้อย 2 แถว' : null;
      _rows = points.length;
    });
    return points.length < 2 ? null : points;
  }

  Future<void> _save() async {
    final points = _parse();
    if (points == null) return;
    final ok = await runApi(
      context,
      () => ref.read(apiProvider).put<dynamic>('/tanks/${widget.tank['id']}/calibration', {
        'points': points,
        'note': _note.text.trim().isEmpty ? null : _note.text.trim(),
      }),
      success: 'บันทึกตารางแปลงแล้ว (${points.length} แถว)',
    );
    if (ok && mounted) {
      _refresh(ref, ['/branches/${widget.branchId}/tanks'], branchId: widget.branchId);
      Navigator.pop(context);
    }
  }

  @override
  void dispose() {
    _text.dispose();
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text('ตารางแปลง · ${widget.tank['name']}'),
        content: SizedBox(
          width: 460,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text('วางตารางจากผู้ติดตั้งถัง บรรทัดละ 1 แถว: ระดับ (มม.), ลิตร\nคัดลอกจาก Excel มาวางได้เลย · การวัดถังเดิมไม่เปลี่ยนตาม'),
              const SizedBox(height: 12),
              TextField(
                controller: _text,
                maxLines: 12,
                style: const TextStyle(fontFamily: 'monospace'),
                decoration: InputDecoration(hintText: '0,0\n100,312.5\n200,880.2', errorText: _error, helperText: _rows > 0 ? '$_rows แถว' : null),
                onChanged: (_) => _parse(),
              ),
              const SizedBox(height: 12),
              TextField(controller: _note, decoration: const InputDecoration(labelText: 'หมายเหตุ เช่น สอบเทียบเมื่อ ...')),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('ยกเลิก')),
          FilledButton(onPressed: _error == null ? _save : null, child: const Text('บันทึก')),
        ],
      );
}

// ---------------------------------------------------------------------------
// หัวจ่าย
// ---------------------------------------------------------------------------

class NozzlesPage extends ConsumerWidget {
  const NozzlesPage({super.key, required this.branchId});
  final String branchId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final path = '/branches/$branchId/nozzles';
    final nozzles = ref.watch(settingsGetProvider(path));
    final tanks = ref.watch(settingsGetProvider('/branches/$branchId/tanks'));
    final tankMap = {for (final t in (tanks.value as List? ?? const [])) t['id'] as String: t as Json};
    return _Page(
      title: 'หัวจ่าย',
      fab: FloatingActionButton.extended(
        onPressed: tanks.value == null
            ? null
            : () => showDialog<void>(context: context, builder: (_) => _NozzleDialog(branchId: branchId, tanks: (tanks.value as List).cast<Json>())),
        icon: const Icon(Icons.add),
        label: const Text('เพิ่มหัวจ่าย'),
      ),
      child: AsyncBody(
        value: nozzles,
        onRetry: () => ref.invalidate(settingsGetProvider(path)),
        builder: (list) => ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
          children: [
            const Text('MVP ยังไม่เชื่อมตู้จ่าย — พนักงานจดเลขมิเตอร์และถ่ายรูปแทน'),
            const SizedBox(height: 12),
            Card(
              child: Column(children: [
                for (final n in (list as List).cast<Json>())
                  ListTile(
                    leading: CircleAvatar(child: Text(n['code'] as String, style: const TextStyle(fontSize: 12))),
                    title: Text('${n['name']}${n['active'] == true ? '' : ' (ปิดใช้งาน)'}'),
                    subtitle: Text('ตู้ ${n['dispenserNo']} · ดูดจาก ${tankMap[n['tankId']]?['name'] ?? '-'} · มิเตอร์วนรอบที่ ${fmtMeter(parseLitres(n['meterModulus'] as String))}'),
                    trailing: IconButton(
                      icon: const Icon(Icons.edit_outlined),
                      onPressed: () => showDialog<void>(
                        context: context,
                        builder: (_) => _NozzleDialog(branchId: branchId, tanks: (tanks.value as List? ?? const []).cast<Json>(), nozzle: n),
                      ),
                    ),
                  ),
              ]),
            ),
          ],
        ),
      ),
    );
  }
}

class _NozzleDialog extends ConsumerStatefulWidget {
  const _NozzleDialog({required this.branchId, required this.tanks, this.nozzle});
  final String branchId;
  final List<Json> tanks;
  final Json? nozzle;

  @override
  ConsumerState<_NozzleDialog> createState() => _NozzleDialogState();
}

class _NozzleDialogState extends ConsumerState<_NozzleDialog> {
  late final _code = TextEditingController(text: widget.nozzle?['code'] as String?);
  late final _name = TextEditingController(text: widget.nozzle?['name'] as String?);
  late final _disp = TextEditingController(text: '${widget.nozzle?['dispenserNo'] ?? 1}');
  late final _mod = TextEditingController(text: widget.nozzle?['meterModulus'] as String? ?? '1000000');
  late String? _tank = widget.nozzle?['tankId'] as String?;
  late bool _active = widget.nozzle?['active'] as bool? ?? true;

  Future<void> _save() async {
    final tank = widget.tanks.where((t) => t['id'] == _tank).firstOrNull;
    final mod = tryParseLitres(_mod.text);
    final disp = int.tryParse(_disp.text);
    if (_code.text.trim().isEmpty || _name.text.trim().isEmpty || tank == null || mod == null || disp == null) {
      showMessage(context, 'กรอกข้อมูลให้ครบ', error: true);
      return;
    }
    final body = {
      'code': _code.text.trim(),
      'name': _name.text.trim(),
      'dispenserNo': disp,
      'tankId': tank['id'],
      'fuelTypeId': tank['fuelTypeId'],
      'meterModulus': litresToApi(mod),
      if (widget.nozzle != null) 'active': _active,
    };
    final api = ref.read(apiProvider);
    final ok = await runApi(
      context,
      () => widget.nozzle == null
          ? api.post<dynamic>('/branches/${widget.branchId}/nozzles', body)
          : api.patch<dynamic>('/nozzles/${widget.nozzle!['id']}', body),
      success: 'บันทึกหัวจ่ายแล้ว',
    );
    if (ok && mounted) {
      _refresh(ref, ['/branches/${widget.branchId}/nozzles'], branchId: widget.branchId);
      Navigator.pop(context);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text(widget.nozzle == null ? 'เพิ่มหัวจ่าย' : 'แก้ไขหัวจ่าย'),
        content: SizedBox(
          width: 400,
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Row(children: [
                Expanded(child: TextField(controller: _code, decoration: const InputDecoration(labelText: 'รหัส เช่น 1A'))),
                const SizedBox(width: 12),
                Expanded(child: DecimalField(controller: _disp, label: 'ตู้ที่', decimals: 0)),
              ]),
              const SizedBox(height: 12),
              TextField(controller: _name, decoration: const InputDecoration(labelText: 'ชื่อ เช่น หัว 1A ดีเซล')),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _tank,
                decoration: const InputDecoration(labelText: 'ดูดน้ำมันจากถัง'),
                items: [for (final t in widget.tanks) DropdownMenuItem(value: t['id'] as String, child: Text(t['name'] as String))],
                onChanged: (v) => setState(() => _tank = v),
              ),
              const SizedBox(height: 12),
              DecimalField(controller: _mod, label: 'มิเตอร์วนรอบที่', suffix: 'ลิตร', helper: 'ค่าสูงสุดของมิเตอร์ + 1 เช่น 1000000'),
              if (widget.nozzle != null)
                SwitchListTile(contentPadding: EdgeInsets.zero, value: _active, onChanged: (v) => setState(() => _active = v), title: const Text('ใช้งาน')),
            ]),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('ยกเลิก')),
          FilledButton(onPressed: _save, child: const Text('บันทึก')),
        ],
      );
}

// ---------------------------------------------------------------------------
// ผู้ใช้
// ---------------------------------------------------------------------------

const _roleLabel = {'owner': 'เจ้าของ', 'manager': 'ผู้จัดการ', 'staff': 'พนักงานหน้าลาน'};

class UsersPage extends ConsumerWidget {
  const UsersPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final users = ref.watch(settingsGetProvider('/users'));
    return _Page(
      title: 'ผู้ใช้และสิทธิ์',
      fab: FloatingActionButton.extended(
        onPressed: () => showDialog<void>(context: context, builder: (_) => const _UserDialog()),
        icon: const Icon(Icons.person_add),
        label: const Text('เพิ่มผู้ใช้'),
      ),
      child: AsyncBody(
        value: users,
        onRetry: () => ref.invalidate(settingsGetProvider('/users')),
        builder: (list) => ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
          children: [
            Card(
              child: Column(children: [
                for (final u in (list as List).cast<Json>())
                  ListTile(
                    leading: CircleAvatar(child: Icon(u['role'] == 'owner' ? Icons.star : (u['role'] == 'manager' ? Icons.manage_accounts : Icons.person))),
                    title: Text('${u['displayName']}${u['active'] == true ? '' : ' (ปิดใช้งาน)'}'),
                    subtitle: Text('${u['username']} · ${_roleLabel[u['role']]}${u['allBranches'] == true ? ' · ทุกสาขา' : ''}'),
                    trailing: IconButton(
                      icon: const Icon(Icons.edit_outlined),
                      onPressed: () => showDialog<void>(context: context, builder: (_) => _UserDialog(user: u)),
                    ),
                  ),
              ]),
            ),
          ],
        ),
      ),
    );
  }
}

class _UserDialog extends ConsumerStatefulWidget {
  const _UserDialog({this.user});
  final Json? user;

  @override
  ConsumerState<_UserDialog> createState() => _UserDialogState();
}

class _UserDialogState extends ConsumerState<_UserDialog> {
  late final _username = TextEditingController(text: widget.user?['username'] as String?);
  late final _name = TextEditingController(text: widget.user?['displayName'] as String?);
  final _password = TextEditingController();
  late String _role = widget.user?['role'] as String? ?? 'staff';
  late bool _active = widget.user?['active'] as bool? ?? true;
  late Set<String> _branches = {...((widget.user?['branchIds'] as List?) ?? const []).cast<String>()};

  @override
  void initState() {
    super.initState();
    final s = ref.read(sessionProvider)!;
    if (widget.user == null && s.branchId != null) _branches = {s.branchId!};
  }

  Future<void> _save() async {
    final isNew = widget.user == null;
    if ((isNew && (_username.text.trim().isEmpty || _password.text.length < 4)) || _name.text.trim().isEmpty) {
      showMessage(context, 'กรอกชื่อผู้ใช้ ชื่อที่แสดง และรหัสผ่านอย่างน้อย 4 ตัว', error: true);
      return;
    }
    final api = ref.read(apiProvider);
    final body = {
      if (isNew) 'username': _username.text.trim().toLowerCase(),
      'displayName': _name.text.trim(),
      'role': _role,
      if (_password.text.isNotEmpty) 'password': _password.text,
      'branchIds': _branches.toList(),
      if (!isNew) 'active': _active,
    };
    final ok = await runApi(
      context,
      () => isNew ? api.post<dynamic>('/users', body) : api.patch<dynamic>('/users/${widget.user!['id']}', body),
      success: 'บันทึกผู้ใช้แล้ว',
    );
    if (ok && mounted) {
      _refresh(ref, ['/users']);
      Navigator.pop(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(sessionProvider)!;
    return AlertDialog(
      title: Text(widget.user == null ? 'เพิ่มผู้ใช้' : 'แก้ไขผู้ใช้'),
      content: SizedBox(
        width: 420,
        child: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            TextField(
              controller: _username,
              enabled: widget.user == null,
              decoration: const InputDecoration(labelText: 'ชื่อผู้ใช้ (a-z, 0-9)'),
              autocorrect: false,
            ),
            const SizedBox(height: 12),
            TextField(controller: _name, decoration: const InputDecoration(labelText: 'ชื่อที่แสดง')),
            const SizedBox(height: 12),
            TextField(
              controller: _password,
              obscureText: true,
              decoration: InputDecoration(labelText: widget.user == null ? 'รหัสผ่าน / PIN' : 'รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)'),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _role,
              decoration: const InputDecoration(labelText: 'บทบาท'),
              items: [
                for (final r in s.isOwner ? ['staff', 'manager', 'owner'] : ['staff']) DropdownMenuItem(value: r, child: Text(_roleLabel[r]!)),
              ],
              onChanged: (v) => setState(() => _role = v ?? 'staff'),
            ),
            const SizedBox(height: 8),
            const Text('สาขาที่เข้าถึงได้'),
            for (final b in s.branches)
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                value: _branches.contains(b.id),
                onChanged: (v) => setState(() => v == true ? _branches.add(b.id) : _branches.remove(b.id)),
                title: Text(b.name),
              ),
            if (widget.user != null)
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                value: _active,
                onChanged: (v) => setState(() => _active = v),
                title: const Text('ใช้งาน'),
                subtitle: const Text('ปิดใช้งาน = ออกจากระบบทุกเครื่องทันที'),
              ),
          ]),
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('ยกเลิก')),
        FilledButton(onPressed: _save, child: const Text('บันทึก')),
      ],
    );
  }
}

class ChangePasswordDialog extends ConsumerStatefulWidget {
  const ChangePasswordDialog({super.key});

  @override
  ConsumerState<ChangePasswordDialog> createState() => _ChangePasswordDialogState();
}

class _ChangePasswordDialogState extends ConsumerState<ChangePasswordDialog> {
  final _a = TextEditingController();
  final _b = TextEditingController();

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: const Text('เปลี่ยนรหัสผ่าน'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: _a, obscureText: true, decoration: const InputDecoration(labelText: 'รหัสผ่านใหม่')),
          const SizedBox(height: 12),
          TextField(controller: _b, obscureText: true, decoration: const InputDecoration(labelText: 'ยืนยันรหัสผ่านใหม่')),
          const SizedBox(height: 8),
          const Text('เปลี่ยนแล้วต้องเข้าสู่ระบบใหม่ทุกเครื่อง', style: TextStyle(fontSize: 12)),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('ยกเลิก')),
          FilledButton(
            onPressed: () async {
              if (_a.text.length < 4 || _a.text != _b.text) {
                showMessage(context, 'รหัสผ่านอย่างน้อย 4 ตัว และต้องตรงกัน', error: true);
                return;
              }
              final s = ref.read(sessionProvider)!;
              final ok = await runApi(context, () => ref.read(apiProvider).patch<dynamic>('/users/${s.userId}', {'password': _a.text}));
              if (ok && context.mounted) {
                Navigator.pop(context);
                await ref.read(sessionProvider.notifier).logout(callServer: false);
              }
            },
            child: const Text('บันทึก'),
          ),
        ],
      );
}

// ---------------------------------------------------------------------------
// LINE
// ---------------------------------------------------------------------------

class LinePage extends ConsumerWidget {
  const LinePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rec = ref.watch(settingsGetProvider('/line/recipients'));
    final log = ref.watch(settingsGetProvider('/line/notifications'));
    return _Page(
      title: 'แจ้งเตือนทาง LINE',
      child: AsyncBody(
        value: rec,
        onRetry: () => ref.invalidate(settingsGetProvider('/line/recipients')),
        builder: (data) {
          final d = data as Json;
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (d['lineConfigured'] != true)
                const Card(child: ListTile(leading: Icon(Icons.info_outline), title: Text('ผู้ให้บริการยังไม่ได้ตั้งค่า LINE OA ของระบบ — ข้อความจะถูกบันทึกแต่ยังไม่ส่ง'))),
              const SectionTitle('วิธีเชื่อม'),
              const Text('1. เพิ่มเพื่อน LINE OA ของระบบ (หรือเชิญเข้ากลุ่ม LINE ของปั๊ม)\n2. กด "สร้างรหัสเชื่อม" ด้านล่าง\n3. พิมพ์รหัส 6 หลักส่งในแชตนั้นภายใน 15 นาที'),
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: () async {
                  try {
                    final r = await ref.read(apiProvider).post<Json>('/line/link-codes');
                    if (!context.mounted) return;
                    await showDialog<void>(
                      context: context,
                      builder: (c) => AlertDialog(
                        title: const Text('รหัสเชื่อม LINE'),
                        content: Column(mainAxisSize: MainAxisSize.min, children: [
                          SelectableText(r['code'] as String, style: Theme.of(context).textTheme.displayMedium?.copyWith(letterSpacing: 8)),
                          const SizedBox(height: 8),
                          const Text('พิมพ์รหัสนี้ส่งใน LINE ภายใน 15 นาที'),
                        ]),
                        actions: [TextButton(onPressed: () => Navigator.pop(c), child: const Text('ปิด'))],
                      ),
                    );
                    ref.invalidate(settingsGetProvider('/line/recipients'));
                  } catch (e) {
                    if (context.mounted) showMessage(context, '$e', error: true);
                  }
                },
                icon: const Icon(Icons.link),
                label: const Text('สร้างรหัสเชื่อม'),
              ),
              const SectionTitle('ผู้รับแจ้งเตือน'),
              Card(
                child: Column(children: [
                  if ((d['recipients'] as List).isEmpty) const ListTile(title: Text('ยังไม่มี')),
                  for (final r in (d['recipients'] as List).cast<Json>())
                    SwitchListTile(
                      value: r['active'] == true,
                      onChanged: (v) async {
                        await runApi(context, () => ref.read(apiProvider).patch<dynamic>('/line/recipients/${r['id']}', {'active': v}));
                        ref.invalidate(settingsGetProvider('/line/recipients'));
                      },
                      secondary: Icon(r['kind'] == 'group' ? Icons.groups : Icons.person),
                      title: Text(r['displayName'] as String? ?? (r['kind'] == 'group' ? 'กลุ่ม LINE' : 'ผู้ใช้ LINE')),
                      subtitle: Text('เชื่อมเมื่อ ${thaiDateTime(r['linkedAt'] as String)}'),
                    ),
                ]),
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: () async {
                  await runApi(context, () => ref.read(apiProvider).post<dynamic>('/line/test'), success: 'ส่งข้อความทดสอบเข้าคิวแล้ว');
                  ref.invalidate(settingsGetProvider('/line/notifications'));
                },
                icon: const Icon(Icons.send),
                label: const Text('ส่งข้อความทดสอบ'),
              ),
              const SectionTitle('ข้อความล่าสุด'),
              ...switch (log) {
                AsyncData(:final value) => [
                    for (final n in (value as List).cast<Json>().take(30))
                      Card(
                        margin: const EdgeInsets.only(bottom: 8),
                        child: ListTile(
                          title: Text(n['message'] as String),
                          subtitle: Text('${thaiDateTime(n['createdAt'] as String)} · ${switch (n['status']) {
                            'sent' => 'ส่งแล้ว',
                            'pending' => 'รอส่ง',
                            'skipped' => 'ไม่ได้ส่ง: ${n['lastError'] ?? ''}',
                            _ => 'ส่งไม่สำเร็จ: ${n['lastError'] ?? ''}',
                          }}'),
                        ),
                      ),
                  ],
                _ => [const SizedBox.shrink()],
              },
            ],
          );
        },
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// เกณฑ์การแจ้งเตือน (เจ้าของ)
// ---------------------------------------------------------------------------

class TenantSettingsPage extends ConsumerStatefulWidget {
  const TenantSettingsPage({super.key});

  @override
  ConsumerState<TenantSettingsPage> createState() => _TenantSettingsPageState();
}

class _TenantSettingsPageState extends ConsumerState<TenantSettingsPage> {
  final _name = TextEditingController();
  final _cash = TextEditingController();
  final _variance = TextEditingController();
  int? _hour;
  bool _loaded = false;

  @override
  Widget build(BuildContext context) {
    final data = ref.watch(settingsGetProvider('/settings'));
    return _Page(
      title: 'เกณฑ์การแจ้งเตือน',
      child: AsyncBody(
        value: data,
        builder: (v) {
          final d = v as Json;
          if (!_loaded) {
            _name.text = d['tenantName'] as String;
            _cash.text = fmtPrice(d['cashAlertSatang'] as int);
            _variance.text = d['varianceAlertPercent'] as String;
            _hour = d['dailySummaryHour'] as int?;
            _loaded = true;
          }
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Card(
                child: ListTile(
                  leading: const Icon(Icons.workspace_premium_outlined),
                  title: Text('แพ็กเกจ ${d['plan']} · ${d['status'] == 'trial' ? 'ทดลองใช้' : d['status']}'),
                  subtitle: d['trialEndsAt'] == null ? null : Text('ทดลองใช้ถึง ${thaiDate(d['trialEndsAt'] as String)}'),
                ),
              ),
              const SizedBox(height: 16),
              TextField(controller: _name, decoration: const InputDecoration(labelText: 'ชื่อปั๊ม')),
              const SizedBox(height: 16),
              DecimalField(controller: _cash, label: 'แจ้งเมื่อเงินขาด/เกินต่อคนต่อกะตั้งแต่', decimals: 2, suffix: 'บาท'),
              const SizedBox(height: 16),
              DecimalField(controller: _variance, label: 'แจ้งเมื่อน้ำมันขาด/เกินเทียบยอดขายตั้งแต่', decimals: 2, suffix: '%'),
              const SizedBox(height: 16),
              DropdownButtonFormField<int?>(
                initialValue: _hour,
                decoration: const InputDecoration(labelText: 'ส่งสรุปประจำวันทาง LINE'),
                items: [
                  const DropdownMenuItem(value: null, child: Text('ไม่ส่ง')),
                  for (var h = 0; h < 24; h++) DropdownMenuItem(value: h, child: Text('${h.toString().padLeft(2, '0')}:00 น.')),
                ],
                onChanged: (v) => setState(() => _hour = v),
              ),
              const SizedBox(height: 24),
              FilledButton(
                onPressed: () async {
                  final cash = tryParseBaht(_cash.text);
                  if (cash == null) return;
                  final ok = await runApi(
                    context,
                    () => ref.read(apiProvider).patch<dynamic>('/settings', {
                      'tenantName': _name.text.trim(),
                      'cashAlertSatang': cash,
                      'varianceAlertPercent': _variance.text.trim(),
                      'dailySummaryHour': _hour,
                    }),
                    success: 'บันทึกแล้ว',
                  );
                  if (ok) ref.invalidate(settingsGetProvider('/settings'));
                },
                child: const Text('บันทึก'),
              ),
            ],
          );
        },
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// สาขา (เจ้าของ)
// ---------------------------------------------------------------------------

class BranchesPage extends ConsumerWidget {
  const BranchesPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final branches = ref.watch(settingsGetProvider('/branches'));
    return _Page(
      title: 'สาขา',
      fab: FloatingActionButton.extended(
        onPressed: () => showDialog<void>(context: context, builder: (_) => const _BranchDialog()),
        icon: const Icon(Icons.add_business),
        label: const Text('เพิ่มสาขา'),
      ),
      child: AsyncBody(
        value: branches,
        builder: (list) => ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
          children: [
            Card(
              child: Column(children: [
                for (final b in (list as List).cast<Json>())
                  ListTile(
                    leading: const Icon(Icons.store),
                    title: Text('${b['name']}${b['active'] == true ? '' : ' (ปิดใช้งาน)'}'),
                    subtitle: Text([b['code'], if (b['address'] != null) b['address'], if (b['taxId'] != null) 'เลขผู้เสียภาษี ${b['taxId']}'].join(' · ')),
                    trailing: IconButton(
                      icon: const Icon(Icons.edit_outlined),
                      onPressed: () => showDialog<void>(context: context, builder: (_) => _BranchDialog(branch: b)),
                    ),
                  ),
              ]),
            ),
          ],
        ),
      ),
    );
  }
}

class _BranchDialog extends ConsumerStatefulWidget {
  const _BranchDialog({this.branch});
  final Json? branch;

  @override
  ConsumerState<_BranchDialog> createState() => _BranchDialogState();
}

class _BranchDialogState extends ConsumerState<_BranchDialog> {
  late final _code = TextEditingController(text: widget.branch?['code'] as String?);
  late final _name = TextEditingController(text: widget.branch?['name'] as String?);
  late final _address = TextEditingController(text: widget.branch?['address'] as String?);
  late final _tax = TextEditingController(text: widget.branch?['taxId'] as String?);
  late bool _active = widget.branch?['active'] as bool? ?? true;

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text(widget.branch == null ? 'เพิ่มสาขา' : 'แก้ไขสาขา'),
        content: SizedBox(
          width: 420,
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              TextField(controller: _code, decoration: const InputDecoration(labelText: 'รหัสสาขา')),
              const SizedBox(height: 12),
              TextField(controller: _name, decoration: const InputDecoration(labelText: 'ชื่อสาขา')),
              const SizedBox(height: 12),
              TextField(controller: _address, decoration: const InputDecoration(labelText: 'ที่อยู่'), maxLines: 2),
              const SizedBox(height: 12),
              TextField(controller: _tax, decoration: const InputDecoration(labelText: 'เลขประจำตัวผู้เสียภาษี (13 หลัก)'), keyboardType: TextInputType.number),
              if (widget.branch != null)
                SwitchListTile(contentPadding: EdgeInsets.zero, value: _active, onChanged: (v) => setState(() => _active = v), title: const Text('ใช้งาน')),
            ]),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('ยกเลิก')),
          FilledButton(
            onPressed: () async {
              final body = {
                'code': _code.text.trim(),
                'name': _name.text.trim(),
                'address': _address.text.trim().isEmpty ? null : _address.text.trim(),
                'taxId': _tax.text.trim().isEmpty ? null : _tax.text.trim(),
                if (widget.branch != null) 'active': _active,
              };
              final api = ref.read(apiProvider);
              final ok = await runApi(
                context,
                () => widget.branch == null ? api.post<dynamic>('/branches', body) : api.patch<dynamic>('/branches/${widget.branch!['id']}', body),
                success: 'บันทึกสาขาแล้ว',
              );
              if (ok && context.mounted) {
                ref.invalidate(settingsGetProvider('/branches'));
                // อัปเดตรายการสาขาในเครื่อง
                final me = await ref.read(apiProvider).get<Json>('/auth/me');
                await ref.read(sessionProvider.notifier).updateBranches([for (final b in me['branches'] as List) Branch.fromJson(b as Json)]);
                if (context.mounted) Navigator.pop(context);
              }
            },
            child: const Text('บันทึก'),
          ),
        ],
      );
}

// ---------------------------------------------------------------------------
// ประวัติการแก้ไขตั้งค่า
// ---------------------------------------------------------------------------

class AuditPage extends ConsumerWidget {
  const AuditPage({super.key});

  static const _table = {
    'users': 'ผู้ใช้',
    'branches': 'สาขา',
    'tanks': 'ถัง',
    'nozzles': 'หัวจ่าย',
    'fuel_types': 'ชนิดน้ำมัน',
    'tenant_settings': 'เกณฑ์แจ้งเตือน',
    'tenants': 'ข้อมูลปั๊ม',
    'shifts': 'สถานะกะ',
    'shift_nozzles': 'พนักงานประจำหัวจ่าย',
    'user_branches': 'สิทธิ์สาขา',
    'line_recipients': 'ผู้รับ LINE',
  };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final log = ref.watch(settingsGetProvider('/audit-log?limit=200'));
    return _Page(
      title: 'ประวัติการแก้ไขตั้งค่า',
      child: AsyncBody(
        value: log,
        builder: (list) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            for (final a in (list as List).cast<Json>())
              ListTile(
                dense: true,
                leading: Icon(a['action'] == 'INSERT' ? Icons.add_circle_outline : (a['action'] == 'DELETE' ? Icons.remove_circle_outline : Icons.edit_outlined)),
                title: Text('${a['action'] == 'INSERT' ? 'เพิ่ม' : a['action'] == 'DELETE' ? 'ลบ' : 'แก้ไข'}${_table[a['table']] ?? a['table']} ${_summary(a)}'),
                subtitle: Text('${a['actorName'] ?? 'ระบบ'} · ${thaiDateTime(a['at'] as String)}'),
              ),
          ],
        ),
      ),
    );
  }

  String _summary(Json a) {
    final n = a['new'] as Json?;
    final o = a['old'] as Json?;
    if (n == null || o == null) return (n ?? o)?['name']?.toString() ?? (n ?? o)?['display_name']?.toString() ?? '';
    final changed = [for (final k in n.keys) if (k != 'updated_at' && '${n[k]}' != '${o[k]}') '$k: ${o[k]} → ${n[k]}'];
    return changed.take(3).join(', ');
  }
}

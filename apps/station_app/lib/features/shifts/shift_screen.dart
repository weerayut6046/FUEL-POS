import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/api.dart';
import '../../core/format.dart';
import '../../core/responsive.dart';
import '../../core/session.dart';
import '../../core/shift_calc.dart';
import '../../core/sync.dart';
import '../../core/units.dart';
import '../../widgets/common.dart';
import '../data.dart';
import 'shift_actions.dart';
import 'shift_model.dart';

/// ขั้นตอนของกะ: หัวจ่ายทีละหัว → เงินที่ส่ง → สรุปและส่งปิดกะ
sealed class _Step {
  const _Step();
}

class _NozzleStep extends _Step {
  const _NozzleStep(this.index);
  final int index;
}

class _MoneyStep extends _Step {
  const _MoneyStep();
}

class _SummaryStep extends _Step {
  const _SummaryStep();
}

final _shiftModelProvider = Provider.family<AsyncValue<ShiftModel?>, (String, String)>((ref, args) {
  final (shiftId, branchId) = args;
  final setup = ref.watch(setupProvider(branchId));
  final detail = ref.watch(shiftDetailProvider(shiftId));
  final ops = ref.watch(outboxProvider);
  if (setup.hasError && !setup.hasValue) return AsyncValue.error(setup.error!, setup.stackTrace!);
  if (detail.hasError && !detail.hasValue) return AsyncValue.error(detail.error!, detail.stackTrace!);
  if (!setup.hasValue || !detail.hasValue || !ops.hasValue) return const AsyncValue.loading();
  final scoped = ops.value!.where((o) => o.scope == 'shift:$shiftId').toList();
  return AsyncValue.data(ShiftModel.build(
    shiftId: shiftId,
    detail: detail.value?.data,
    setup: setup.value!.data,
    ops: scoped,
    fromCache: detail.value?.fromCache ?? false,
  ));
});

class ShiftScreen extends ConsumerStatefulWidget {
  const ShiftScreen({super.key, required this.shiftId});
  final String shiftId;

  @override
  ConsumerState<ShiftScreen> createState() => _ShiftScreenState();
}

class _ShiftScreenState extends ConsumerState<ShiftScreen> {
  int _step = 0;

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider)!;
    final value = ref.watch(_shiftModelProvider((widget.shiftId, session.branchId!)));
    return AsyncBody(
      value: value,
      onRetry: () => ref.invalidate(shiftDetailProvider(widget.shiftId)),
      builder: (shift) {
        if (shift == null) {
          return const Center(child: Text('ไม่พบกะนี้ (อาจยังไม่ได้ซิงก์ หรือถูกลบจากเครื่อง)'));
        }
        final steps = <_Step>[for (var i = 0; i < shift.nozzles.length; i++) _NozzleStep(i), const _MoneyStep(), const _SummaryStep()];
        if (_step >= steps.length) _step = steps.length - 1;
        // ผู้จัดการเปิดกะที่ส่งแล้ว → เริ่มที่หน้าสรุป
        final header = _Header(shift: shift);
        Widget content(_Step s) => switch (s) {
              _NozzleStep(:final index) => _NozzlePanel(key: ValueKey(shift.nozzles[index].nozzleId), shift: shift, nozzle: shift.nozzles[index]),
              _MoneyStep() => _MoneyPanel(shift: shift),
              _SummaryStep() => _SummaryPanel(shift: shift),
            };
        String label(_Step s) => switch (s) {
              _NozzleStep(:final index) => shift.nozzles[index].code,
              _MoneyStep() => 'เงินส่ง',
              _SummaryStep() => 'สรุป',
            };
        bool done(_Step s) => switch (s) {
              _NozzleStep(:final index) => shift.nozzles[index].done,
              _MoneyStep() => shift.calc.byAttendant.where((a) => a.expectedSatang > 0).every((a) => a.collectedSatang > 0),
              _SummaryStep() => shift.status != 'open',
            };

        if (context.isCompact) {
          return Column(
            children: [
              header,
              SizedBox(
                height: 56,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  children: [
                    for (var i = 0; i < steps.length; i++)
                      Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: ChoiceChip(
                          avatar: done(steps[i]) ? const Icon(Icons.check_circle, size: 18) : null,
                          label: Text(label(steps[i])),
                          selected: i == _step,
                          onSelected: (_) => setState(() => _step = i),
                        ),
                      ),
                  ],
                ),
              ),
              const Divider(height: 1),
              Expanded(child: SingleChildScrollView(padding: const EdgeInsets.all(16), child: content(steps[_step]))),
              SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                  child: Row(
                    children: [
                      if (_step > 0)
                        Expanded(child: OutlinedButton.icon(onPressed: () => setState(() => _step--), icon: const Icon(Icons.chevron_left), label: const Text('ก่อนหน้า'))),
                      if (_step > 0 && _step < steps.length - 1) const SizedBox(width: 12),
                      if (_step < steps.length - 1)
                        Expanded(child: FilledButton.icon(onPressed: () => setState(() => _step++), icon: const Icon(Icons.chevron_right), label: Text('ถัดไป: ${label(steps[_step + 1])}'))),
                    ],
                  ),
                ),
              ),
            ],
          );
        }

        // แท็บเล็ต/คอม: รายการซ้าย รายละเอียดขวา
        return Column(
          children: [
            header,
            const Divider(height: 1),
            Expanded(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: context.isExpanded ? 300 : 240,
                    child: ListView(
                      children: [
                        for (var i = 0; i < steps.length; i++)
                          _StepTile(
                            shift: shift,
                            step: steps[i],
                            label: label(steps[i]),
                            done: done(steps[i]),
                            selected: i == _step,
                            onTap: () => setState(() => _step = i),
                          ),
                      ],
                    ),
                  ),
                  const VerticalDivider(width: 1),
                  Expanded(
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.all(24),
                      child: MaxWidth(width: 760, child: content(steps[_step])),
                    ),
                  ),
                ],
              ),
            ),
          ],
        );
      },
    );
  }
}

class _StepTile extends StatelessWidget {
  const _StepTile({required this.shift, required this.step, required this.label, required this.done, required this.selected, required this.onTap});
  final ShiftModel shift;
  final _Step step;
  final String label;
  final bool done;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    String? subtitle;
    var hasError = false;
    if (step case _NozzleStep(:final index)) {
      final n = shift.nozzles[index];
      final line = shift.calc.line(n.nozzleId);
      subtitle = line?.soldMilli == null ? 'ยังจดไม่ครบ' : '${fmtLitres(line!.soldMilli!)} ลิตร · ${fmtBaht(line.amountSatang)}';
      hasError = shift.calc.issues.any((i) => i.nozzleId == n.nozzleId && i.severity == Severity.error && i.code != 'MISSING_CLOSE');
      final fuel = shift.fuels[n.fuelTypeId];
      return ListTile(
        selected: selected,
        onTap: onTap,
        leading: CircleAvatar(backgroundColor: Color(fuel?.color ?? 0xFF888888), child: Text(n.code, style: const TextStyle(color: Colors.white, fontSize: 13))),
        title: Text(fuel?.name ?? n.name),
        subtitle: Text(subtitle),
        trailing: hasError
            ? Icon(Icons.error, color: Theme.of(context).colorScheme.error)
            : done
                ? Icon(Icons.check_circle, color: Colors.green.shade700)
                : null,
      );
    }
    return ListTile(
      selected: selected,
      onTap: onTap,
      leading: Icon(step is _MoneyStep ? Icons.payments_outlined : Icons.fact_check_outlined),
      title: Text(label),
      subtitle: step is _MoneyStep
          ? DiffText(shift.calc.diffSatang)
          : Text('${shift.issues.where((i) => i.severity == Severity.error).length} ข้อผิดพลาด · ${shift.issues.where((i) => i.severity == Severity.warning).length} คำเตือน'),
      trailing: done ? Icon(Icons.check_circle, color: Colors.green.shade700) : null,
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.shift});
  final ShiftModel shift;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Material(
      color: theme.colorScheme.surfaceContainerLow,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(8, 8, 16, 8),
        child: Row(
          children: [
            IconButton(onPressed: () => context.go('/shifts'), icon: const Icon(Icons.arrow_back), tooltip: 'กลับ'),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('กะ ${shift.shiftNo} · ${thaiDate(shift.businessDate, weekday: true)}', style: theme.textTheme.titleMedium),
                  Text(
                    '${fmtLitres(shift.calc.soldMilli)} ลิตร · ควรได้ ${fmtBaht(shift.calc.expectedSatang)} บาท',
                    style: theme.textTheme.bodySmall,
                  ),
                ],
              ),
            ),
            if (shift.fromCache) const Padding(padding: EdgeInsets.only(right: 8), child: Icon(Icons.cloud_off, size: 18)),
            StatusChip(shift.pendingSubmit ? 'submitted' : shift.status, pending: shift.pendingOpen || shift.pendingSubmit),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// หัวจ่าย
// ---------------------------------------------------------------------------

class _NozzlePanel extends ConsumerStatefulWidget {
  const _NozzlePanel({super.key, required this.shift, required this.nozzle});
  final ShiftModel shift;
  final NozzleModel nozzle;

  @override
  ConsumerState<_NozzlePanel> createState() => _NozzlePanelState();
}

class _NozzlePanelState extends ConsumerState<_NozzlePanel> {
  late final _open = TextEditingController(text: _fmt(widget.nozzle.open?.milli));
  late final _close = TextEditingController(text: _fmt(widget.nozzle.close?.milli));
  late final _test = TextEditingController(text: widget.nozzle.testMilli == 0 ? '' : litresToApi(widget.nozzle.testMilli));
  late bool _rollover = widget.nozzle.close?.rollover ?? false;
  Uint8List? _openPhoto;
  Uint8List? _closePhoto;
  bool _busy = false;

  static String _fmt(int? milli) => milli == null ? '' : litresToApi(milli);

  @override
  void dispose() {
    _open.dispose();
    _close.dispose();
    _test.dispose();
    super.dispose();
  }

  bool get _editable {
    final s = ref.read(sessionProvider)!;
    return widget.shift.isOpen || (widget.shift.status == 'submitted' && s.isManager && !widget.shift.pendingSubmit);
  }

  Future<Uint8List?> _takePhoto() async {
    final picker = ImagePicker();
    final source = picker.supportsImageSource(ImageSource.camera) ? ImageSource.camera : ImageSource.gallery;
    final file = await picker.pickImage(source: source, maxWidth: 1600, maxHeight: 1600, imageQuality: 70);
    return file?.readAsBytes();
  }

  Future<void> _save(String kind) async {
    final ctrl = kind == 'open' ? _open : _close;
    final milli = tryParseLitres(ctrl.text);
    if (milli == null) {
      showMessage(context, 'กรอกเลขมิเตอร์ให้ถูกต้อง (ทศนิยมไม่เกิน 3 ตำแหน่ง)', error: true);
      return;
    }
    final n = widget.nozzle;
    if (milli >= n.modulusMilli) {
      showMessage(context, 'เลขมิเตอร์ต้องน้อยกว่า ${fmtMeter(n.modulusMilli)} (ค่าที่มิเตอร์วนรอบ)', error: true);
      return;
    }
    final existing = kind == 'open' ? n.open : n.close;
    final photo = kind == 'open' ? _openPhoto : _closePhoto;
    final rollover = kind == 'close' && _rollover;
    if (existing != null && existing.milli == milli && existing.rollover == rollover && photo == null) return;
    String? reason;
    if (existing != null && !existing.pending) {
      reason = await askReason(context, initial: existing.milli == milli && photo != null ? 'เพิ่มรูปมิเตอร์' : null);
      if (reason == null) return;
    }
    setState(() => _busy = true);
    await ref.read(shiftActionsProvider).recordReading(
          shift: widget.shift,
          nozzle: n,
          kind: kind,
          milli: milli,
          rollover: rollover,
          photo: photo,
          reason: reason,
        );
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (kind == 'open') {
        _openPhoto = null;
      } else {
        _closePhoto = null;
      }
    });
    showMessage(context, 'บันทึก${kind == 'open' ? 'ต้นกะ' : 'ปลายกะ'}หัว ${n.code} แล้ว');
  }

  Future<void> _saveTest() async {
    final milli = _test.text.trim().isEmpty ? 0 : tryParseLitres(_test.text);
    if (milli == null) return;
    if (milli == widget.nozzle.testMilli) return;
    String? reason;
    if (widget.nozzle.testId != null && !widget.nozzle.testPending) {
      reason = await askReason(context);
      if (reason == null) return;
    }
    await ref.read(shiftActionsProvider).recordPumpTest(shift: widget.shift, nozzle: widget.nozzle, milli: milli, reason: reason);
    if (mounted) showMessage(context, 'บันทึกน้ำมันทดสอบแล้ว');
  }

  @override
  Widget build(BuildContext context) {
    final shift = widget.shift;
    final n = widget.nozzle;
    final theme = Theme.of(context);
    final fuel = shift.fuels[n.fuelTypeId];
    final editable = _editable;
    final issues = shift.issues.where((i) => i.nozzleId == n.nozzleId && i.code != 'MISSING_CLOSE' && i.code != 'MISSING_OPEN').toList();

    // พรีวิวจากค่าที่กำลังพิมพ์ (ยังไม่บันทึก)
    final openMilli = tryParseLitres(_open.text) ?? n.open?.milli;
    final closeMilli = tryParseLitres(_close.text) ?? n.close?.milli;
    final meter = meterLitres(openMilli, closeMilli, _rollover, n.modulusMilli);
    final testMilli = tryParseLitres(_test.text) ?? n.testMilli;
    final sold = meter == null ? null : meter - testMilli;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            CircleAvatar(radius: 26, backgroundColor: Color(fuel?.color ?? 0xFF888888), child: Text(n.code, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold))),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(fuel?.name ?? n.name, style: theme.textTheme.titleLarge),
                  Text('ตู้ ${n.dispenserNo} · ${n.name} · ${fmtPrice(n.priceSatang)} บาท/ลิตร', style: theme.textTheme.bodySmall),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        _AttendantPicker(shift: shift, nozzle: n, enabled: editable),
        const SizedBox(height: 16),

        // ต้นกะ
        _ReadingCard(
          title: 'มิเตอร์ต้นกะ',
          controller: _open,
          reading: n.open,
          editable: editable,
          busy: _busy,
          photo: _openPhoto,
          hint: n.prevCloseMilli == null ? null : 'ปลายกะก่อนหน้า: ${fmtMeter(n.prevCloseMilli!)}',
          suggestion: n.open == null && n.prevCloseMilli != null ? n.prevCloseMilli : null,
          onUseSuggestion: (v) {
            _open.text = litresToApi(v);
            setState(() {});
            _save('open');
          },
          onChanged: () => setState(() {}),
          onPhoto: () async {
            final p = await _takePhoto();
            if (p != null) setState(() => _openPhoto = p);
          },
          onSave: () => _save('open'),
        ),
        const SizedBox(height: 12),

        // ปลายกะ
        _ReadingCard(
          title: 'มิเตอร์ปลายกะ',
          controller: _close,
          reading: n.close,
          editable: editable,
          busy: _busy,
          photo: _closePhoto,
          autofocus: n.open != null && n.close == null,
          onChanged: () => setState(() {}),
          onPhoto: () async {
            final p = await _takePhoto();
            if (p != null) setState(() => _closePhoto = p);
          },
          onSave: () => _save('close'),
          extra: CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            value: _rollover,
            onChanged: editable ? (v) => setState(() => _rollover = v ?? false) : null,
            title: const Text('มิเตอร์วนรอบ (ครบรอบแล้วกลับไปเริ่มที่ 0)'),
            controlAffinity: ListTileControlAffinity.leading,
          ),
        ),
        const SizedBox(height: 12),

        ExpansionTile(
          tilePadding: EdgeInsets.zero,
          initiallyExpanded: n.testMilli > 0,
          title: Text('น้ำมันทดสอบ/ตวงเทกลับถัง${n.testMilli > 0 ? ' · ${fmtLitres(n.testMilli)} ลิตร' : ''}'),
          children: [
            Row(
              children: [
                Expanded(child: DecimalField(controller: _test, label: 'ลิตรที่เทกลับถัง', suffix: 'ลิตร', enabled: editable, onChanged: (_) => setState(() {}))),
                const SizedBox(width: 12),
                OutlinedButton(onPressed: editable ? _saveTest : null, child: const Text('บันทึก')),
              ],
            ),
            const SizedBox(height: 12),
          ],
        ),

        // ผลคำนวณ
        Card(
          color: theme.colorScheme.secondaryContainer,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Expanded(child: _Figure(label: 'ลิตรขาย', value: sold == null ? '-' : fmtLitres(sold))),
                Expanded(child: _Figure(label: 'ยอดที่ควรได้ (บาท)', value: sold == null ? '-' : fmtBaht(amountSatang(sold, n.priceSatang)))),
              ],
            ),
          ),
        ),
        if (issues.isNotEmpty) ...[
          const SizedBox(height: 8),
          for (final i in issues) IssueTile(i, dense: true),
        ],
      ],
    );
  }
}

class _Figure extends StatelessWidget {
  const _Figure({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: Theme.of(context).textTheme.bodySmall),
          Text(value, style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w600)),
        ],
      );
}

class _ReadingCard extends StatelessWidget {
  const _ReadingCard({
    required this.title,
    required this.controller,
    required this.reading,
    required this.editable,
    required this.busy,
    required this.photo,
    required this.onChanged,
    required this.onPhoto,
    required this.onSave,
    this.hint,
    this.suggestion,
    this.onUseSuggestion,
    this.extra,
    this.autofocus = false,
  });

  final String title;
  final TextEditingController controller;
  final ReadingModel? reading;
  final bool editable;
  final bool busy;
  final Uint8List? photo;
  final VoidCallback onChanged;
  final VoidCallback onPhoto;
  final VoidCallback onSave;
  final String? hint;
  final int? suggestion;
  final ValueChanged<int>? onUseSuggestion;
  final Widget? extra;
  final bool autofocus;

  @override
  Widget build(BuildContext context) {
    final r = reading;
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(child: Text(title, style: theme.textTheme.titleMedium)),
                if (r != null)
                  Text(
                    r.pending ? 'รอส่ง' : 'บันทึกโดย ${r.byName ?? '-'}${r.at == null ? '' : ' ${thaiTime(r.at!)}'}',
                    style: theme.textTheme.bodySmall?.copyWith(color: r.pending ? Colors.orange.shade800 : null),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            DecimalField(
              controller: controller,
              label: 'เลขมิเตอร์ (ลิตร)',
              big: true,
              enabled: editable,
              autofocus: autofocus && editable,
              helper: hint,
              onChanged: (_) => onChanged(),
            ),
            if (suggestion != null && editable) ...[
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: busy ? null : () => onUseSuggestion?.call(suggestion!),
                icon: const Icon(Icons.done_all),
                label: Text('ใช้ค่าปลายกะก่อนหน้า ${fmtMeter(suggestion!)}'),
              ),
            ],
            ?extra,
            const SizedBox(height: 8),
            Row(
              children: [
                if (photo != null)
                  ClipRRect(borderRadius: BorderRadius.circular(8), child: Image.memory(photo!, width: 56, height: 56, fit: BoxFit.cover))
                else if (r?.photoId != null)
                  PhotoView(photoId: r!.photoId!)
                else
                  Container(
                    width: 56,
                    height: 56,
                    decoration: BoxDecoration(borderRadius: BorderRadius.circular(8), border: Border.all(color: theme.colorScheme.outlineVariant)),
                    child: const Icon(Icons.no_photography_outlined),
                  ),
                const SizedBox(width: 12),
                OutlinedButton.icon(
                  onPressed: editable ? onPhoto : null,
                  icon: const Icon(Icons.photo_camera_outlined),
                  label: Text(photo == null ? 'ถ่ายรูปมิเตอร์' : 'ถ่ายใหม่'),
                ),
                const Spacer(),
                FilledButton(onPressed: editable && !busy ? onSave : null, child: const Text('บันทึก')),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _AttendantPicker extends ConsumerWidget {
  const _AttendantPicker({required this.shift, required this.nozzle, required this.enabled});
  final ShiftModel shift;
  final NozzleModel nozzle;
  final bool enabled;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return DropdownButtonFormField<String?>(
      initialValue: nozzle.attendantId,
      decoration: const InputDecoration(labelText: 'พนักงานที่รับผิดชอบเงินของหัวนี้', prefixIcon: Icon(Icons.badge_outlined)),
      items: [
        const DropdownMenuItem(value: null, child: Text('ไม่ระบุ')),
        for (final s in shift.staff) DropdownMenuItem(value: s.id, child: Text(s.name)),
      ],
      onChanged: enabled
          ? (v) async {
              if (v == nozzle.attendantId) return;
              await ref.read(shiftActionsProvider).setAttendant(shift: shift, nozzle: nozzle, attendantId: v);
            }
          : null,
    );
  }
}

// ---------------------------------------------------------------------------
// เงินที่ส่ง
// ---------------------------------------------------------------------------

class _MoneyPanel extends ConsumerWidget {
  const _MoneyPanel({required this.shift});
  final ShiftModel shift;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider)!;
    final ids = <String>{
      for (final id in shift.attendantIds) ?id,
      if (shift.isOpen && session.role == 'staff') session.userId,
    }.toList();
    final editable = shift.isOpen || (shift.status == 'submitted' && session.isManager && !shift.pendingSubmit);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('เงินที่ส่งแยกตามพนักงาน', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 4),
        const Text('กรอกยอดแต่ละช่องทาง ระบบเทียบกับยอดที่ควรได้จากหัวจ่ายที่รับผิดชอบ'),
        const SizedBox(height: 16),
        if (ids.isEmpty) const Text('ยังไม่ได้กำหนดพนักงานให้หัวจ่าย'),
        for (final id in ids) ...[
          _AttendantMoney(key: ValueKey(id), shift: shift, attendantId: id, editable: editable),
          const SizedBox(height: 12),
        ],
        if (shift.calc.attendant(null) case final unassigned? when unassigned.expectedSatang > 0)
          Card(
            child: ListTile(
              leading: const Icon(Icons.warning_amber_rounded),
              title: const Text('หัวจ่ายที่ยังไม่ระบุพนักงาน'),
              subtitle: Text('ยอดที่ควรได้ ${fmtBaht(unassigned.expectedSatang)} บาท — กำหนดพนักงานที่หน้าหัวจ่าย'),
            ),
          ),
      ],
    );
  }
}

class _AttendantMoney extends ConsumerStatefulWidget {
  const _AttendantMoney({super.key, required this.shift, required this.attendantId, required this.editable});
  final ShiftModel shift;
  final String attendantId;
  final bool editable;

  @override
  ConsumerState<_AttendantMoney> createState() => _AttendantMoneyState();
}

class _AttendantMoneyState extends ConsumerState<_AttendantMoney> {
  late final Map<String, TextEditingController> _ctrls = {
    for (final m in paymentMethods)
      m: TextEditingController(text: _initial(m)),
  };
  bool _busy = false;

  String _initial(String method) {
    final c = widget.shift.collection(widget.attendantId, method);
    return c == null || c.amountSatang == 0 ? '' : (c.amountSatang / 100).toStringAsFixed(2);
  }

  @override
  void dispose() {
    for (final c in _ctrls.values) {
      c.dispose();
    }
    super.dispose();
  }

  int _typedTotal() => _ctrls.values.fold(0, (s, c) => s + (tryParseBaht(c.text) ?? 0));

  Future<void> _save() async {
    final changes = <String, int>{};
    for (final m in paymentMethods) {
      final v = tryParseBaht(_ctrls[m]!.text);
      if (v == null) {
        showMessage(context, 'ยอด${methodLabel[m]}ไม่ถูกต้อง', error: true);
        return;
      }
      final existing = widget.shift.collection(widget.attendantId, m);
      if ((existing?.amountSatang ?? 0) != v) changes[m] = v;
    }
    if (changes.isEmpty) return;
    String? reason;
    final needsReason = changes.keys.any((m) {
      final e = widget.shift.collection(widget.attendantId, m);
      return e != null && !e.pending;
    });
    if (needsReason) {
      reason = await askReason(context, initial: 'แก้ไขยอดเงินส่ง');
      if (reason == null) return;
    }
    setState(() => _busy = true);
    for (final e in changes.entries) {
      await ref.read(shiftActionsProvider).recordCollection(
            shift: widget.shift,
            attendantId: widget.attendantId,
            method: e.key,
            amountSatang: e.value,
            reason: reason,
          );
    }
    if (!mounted) return;
    setState(() => _busy = false);
    showMessage(context, 'บันทึกเงินส่งของ ${widget.shift.nameOf(widget.attendantId)} แล้ว');
  }

  @override
  Widget build(BuildContext context) {
    final a = widget.shift.calc.attendant(widget.attendantId);
    final expected = a?.expectedSatang ?? 0;
    final typed = _typedTotal();
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                const Icon(Icons.person),
                const SizedBox(width: 8),
                Expanded(child: Text(widget.shift.nameOf(widget.attendantId), style: theme.textTheme.titleMedium)),
                Text('ควรได้ ${fmtBaht(expected)}', style: theme.textTheme.titleSmall),
              ],
            ),
            const SizedBox(height: 12),
            LayoutBuilder(builder: (context, c) {
              final cols = c.maxWidth > 520 ? 3 : 2;
              final w = (c.maxWidth - (cols - 1) * 12) / cols;
              return Wrap(
                spacing: 12,
                runSpacing: 12,
                children: [
                  for (final m in paymentMethods)
                    SizedBox(
                      width: w,
                      child: DecimalField(
                        controller: _ctrls[m]!,
                        label: methodLabel[m]!,
                        decimals: 2,
                        suffix: '฿',
                        enabled: widget.editable,
                        onChanged: (_) => setState(() {}),
                      ),
                    ),
                ],
              );
            }),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('รวมส่ง ${fmtBaht(typed)} บาท'),
                      DiffText(typed - expected, style: theme.textTheme.titleMedium),
                    ],
                  ),
                ),
                FilledButton(onPressed: widget.editable && !_busy ? _save : null, child: const Text('บันทึกเงินส่ง')),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// สรุป ส่งปิดกะ ยืนยันกะ
// ---------------------------------------------------------------------------

class _SummaryPanel extends ConsumerStatefulWidget {
  const _SummaryPanel({required this.shift});
  final ShiftModel shift;

  @override
  ConsumerState<_SummaryPanel> createState() => _SummaryPanelState();
}

class _SummaryPanelState extends ConsumerState<_SummaryPanel> {
  final _note = TextEditingController();
  bool _ack = false;
  bool _busy = false;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('ส่งปิดกะ?'),
        content: Text('หลังส่งแล้ว พนักงานจะแก้ไขไม่ได้ ผู้จัดการจะเป็นผู้ตรวจและยืนยัน\n\nยอดที่ควรได้ ${fmtBaht(widget.shift.calc.expectedSatang)} บาท · ส่งจริง ${fmtBaht(widget.shift.calc.collectedSatang)} บาท'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('ยกเลิก')),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('ส่งปิดกะ')),
        ],
      ),
    );
    if (ok != true) return;
    await ref.read(shiftActionsProvider).submit(shift: widget.shift, note: _note.text.trim().isEmpty ? null : _note.text.trim());
    if (mounted) showMessage(context, 'ส่งปิดกะแล้ว รอผู้จัดการยืนยัน');
  }

  Future<void> _approve() async {
    setState(() => _busy = true);
    final ok = await runApi(context, () async {
      await ref.read(syncProvider.notifier).flush();
      await ref.read(shiftActionsProvider).approve(widget.shift.id, note: _note.text.trim(), acknowledge: _ack);
    }, success: 'ยืนยันกะแล้ว');
    if (ok) ref.invalidate(shiftDetailProvider(widget.shift.id));
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _reopen() async {
    final reason = await askReason(context, title: 'เหตุผลที่เปิดกะกลับมาแก้ไข');
    if (reason == null || !mounted) return;
    final ok = await runApi(context, () => ref.read(shiftActionsProvider).reopen(widget.shift.id, reason), success: 'เปิดกะกลับมาแก้ไขแล้ว');
    if (ok) ref.invalidate(shiftDetailProvider(widget.shift.id));
  }

  @override
  Widget build(BuildContext context) {
    final shift = widget.shift;
    final session = ref.watch(sessionProvider)!;
    final calc = shift.calc;
    final theme = Theme.of(context);
    final issues = shift.issues;
    final errors = issues.where((i) => i.severity == Severity.error).toList();
    final warnings = issues.where((i) => i.severity == Severity.warning).toList();

    final byFuel = <String, (int, int)>{};
    for (final n in shift.nozzles) {
      final l = calc.line(n.nozzleId);
      if (l?.soldMilli == null) continue;
      final cur = byFuel[n.fuelTypeId] ?? (0, 0);
      byFuel[n.fuelTypeId] = (cur.$1 + l!.soldMilli!, cur.$2 + l.amountSatang);
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('สรุปกะ', style: theme.textTheme.titleLarge),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                for (final e in byFuel.entries)
                  _row(shift.fuels[e.key]?.name ?? '-', '${fmtLitres(e.value.$1)} ลิตร', fmtBaht(e.value.$2)),
                const Divider(),
                _row('รวม', '${fmtLitres(calc.soldMilli)} ลิตร', fmtBaht(calc.expectedSatang), bold: true),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final a in calc.byAttendant)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(shift.nameOf(a.attendantId)),
                    subtitle: Text('ควรได้ ${fmtBaht(a.expectedSatang)} · ส่ง ${fmtBaht(a.collectedSatang)}'),
                    trailing: DiffText(a.diffSatang),
                  ),
                const Divider(),
                Row(children: [const Expanded(child: Text('เงินขาด/เกินทั้งกะ')), DiffText(calc.diffSatang, style: theme.textTheme.titleMedium)]),
              ],
            ),
          ),
        ),
        if (issues.isNotEmpty) ...[
          const SectionTitle('สิ่งที่ต้องตรวจ'),
          Card(child: Column(children: [for (final i in issues) IssueTile(i, dense: true)])),
        ],
        const SizedBox(height: 16),

        // ส่งปิดกะ
        if (shift.isOpen) ...[
          TextField(controller: _note, decoration: const InputDecoration(labelText: 'หมายเหตุ (ถ้ามี)'), maxLines: 2),
          const SizedBox(height: 12),
          if (errors.isNotEmpty) Text('ต้องแก้ข้อผิดพลาด ${errors.length} รายการก่อนจึงจะส่งปิดกะได้', style: TextStyle(color: theme.colorScheme.error)),
          FilledButton.icon(onPressed: errors.isEmpty ? _submit : null, icon: const Icon(Icons.send), label: const Text('ส่งปิดกะ')),
        ],
        if (shift.pendingSubmit)
          const ListTile(leading: Icon(Icons.cloud_upload_outlined), title: Text('ส่งปิดกะแล้ว — รอซิงก์ขึ้นระบบ')),

        // ผู้จัดการยืนยัน
        if (shift.status == 'submitted' && !shift.pendingSubmit) ...[
          if (session.isManager) ...[
            const SectionTitle('ยืนยันกะ (ผู้จัดการ)'),
            if (warnings.isNotEmpty)
              CheckboxListTile(
                value: _ack,
                onChanged: (v) => setState(() => _ack = v ?? false),
                title: Text('ตรวจคำเตือน ${warnings.length} รายการแล้ว'),
                controlAffinity: ListTileControlAffinity.leading,
              ),
            TextField(
              controller: _note,
              decoration: InputDecoration(labelText: warnings.isEmpty ? 'หมายเหตุ (ถ้ามี)' : 'หมายเหตุการตรวจ (จำเป็น)'),
              maxLines: 2,
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: _busy || errors.isNotEmpty || (warnings.isNotEmpty && !_ack) ? null : _approve,
              icon: const Icon(Icons.verified),
              label: const Text('ยืนยันกะ'),
            ),
          ] else
            const ListTile(leading: Icon(Icons.hourglass_top), title: Text('รอผู้จัดการตรวจและยืนยัน')),
        ],
        if (shift.status == 'approved')
          ListTile(
            leading: Icon(Icons.verified, color: Colors.green.shade700),
            title: Text('ยืนยันโดย ${shift.approvedByName ?? '-'}'),
            subtitle: shift.approvalNote == null ? null : Text(shift.approvalNote!),
          ),
        if (session.isManager && shift.status != 'open' && !shift.pendingSubmit) ...[
          const SizedBox(height: 8),
          OutlinedButton.icon(onPressed: _reopen, icon: const Icon(Icons.lock_open), label: const Text('เปิดกะกลับมาแก้ไข')),
        ],
        _History(shift: shift),
      ],
    );
  }

  Widget _row(String a, String b, String c, {bool bold = false}) {
    final style = bold ? const TextStyle(fontWeight: FontWeight.w700) : null;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(flex: 3, child: Text(a, style: style)),
          Expanded(flex: 3, child: Text(b, textAlign: TextAlign.right, style: style)),
          Expanded(flex: 3, child: Text(c, textAlign: TextAlign.right, style: style)),
        ],
      ),
    );
  }
}

/// ประวัติการบันทึกและการแก้ไขทุกครั้ง (ใคร แก้อะไร เมื่อไร เพราะอะไร)
class _History extends StatelessWidget {
  const _History({required this.shift});
  final ShiftModel shift;

  @override
  Widget build(BuildContext context) {
    final readings = (shift.history['readings'] as List? ?? const []).cast<Map<String, dynamic>>();
    final collections = (shift.history['collections'] as List? ?? const []).cast<Map<String, dynamic>>();
    final corrections = [
      ...readings.where((r) => r['supersedesId'] != null),
      ...collections.where((c) => c['supersedesId'] != null),
    ];
    final code = {for (final n in shift.nozzles) n.nozzleId: n.code};
    return ExpansionTile(
      tilePadding: EdgeInsets.zero,
      title: Text('ประวัติ (${shift.events.length} เหตุการณ์ · แก้ไข ${corrections.length} ครั้ง)'),
      children: [
        for (final e in shift.events.cast<Map<String, dynamic>>())
          ListTile(
            dense: true,
            leading: const Icon(Icons.history),
            title: Text('${_action(e['action'] as String)} โดย ${e['actorName'] ?? '-'}'),
            subtitle: Text('${thaiDateTime(e['at'] as String)}${e['note'] == null ? '' : ' · ${e['note']}'}'),
          ),
        for (final r in corrections)
          ListTile(
            dense: true,
            leading: const Icon(Icons.edit_note),
            title: Text(r.containsKey('reading')
                ? 'แก้${r['kind'] == 'open' ? 'ต้นกะ' : 'ปลายกะ'} หัว ${code[r['nozzleId']] ?? ''} เป็น ${r['reading']}'
                : 'แก้เงินส่ง ${shift.nameOf(r['attendantId'] as String?)} ${methodLabel[r['method']] ?? ''} เป็น ${fmtBaht(r['amountSatang'] as int)}'),
            subtitle: Text('${r['recordedByName']} · ${thaiDateTime(r['recordedAt'] as String)} · เหตุผล: ${r['reason']}'),
          ),
      ],
    );
  }

  String _action(String a) => switch (a) {
        'open' => 'เปิดกะ',
        'submit' => 'ส่งปิดกะ',
        'approve' => 'ยืนยันกะ',
        'reopen' => 'เปิดกะกลับ',
        _ => a,
      };
}

/// ใช้ในหน้าจออื่นเพื่อตรวจว่า error มาจากเน็ตหลุดหรือไม่
bool isNetworkError(Object e) => e is ApiException && e.isNetwork;

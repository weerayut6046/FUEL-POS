import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/format.dart';
import '../../core/responsive.dart';
import '../../core/session.dart';
import '../../core/sync.dart';
import '../../core/units.dart';
import '../../widgets/common.dart';
import '../data.dart';
import 'shift_actions.dart';

/// รายการกะของสาขา + ปุ่มเปิดกะ/ทำกะต่อ
class ShiftListScreen extends ConsumerStatefulWidget {
  const ShiftListScreen({super.key});

  @override
  ConsumerState<ShiftListScreen> createState() => _ShiftListScreenState();
}

class _ShiftListScreenState extends ConsumerState<ShiftListScreen> {
  int _days = 7;

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider)!;
    final branchId = session.branchId!;
    final to = todayIso();
    final args = RangeArgs(branchId, addDays(to, -_days), addDays(to, 1));
    final list = ref.watch(shiftListProvider(args));
    final setup = ref.watch(setupProvider(branchId));
    final ops = ref.watch(outboxProvider).value ?? const [];

    // กะที่เปิดในเครื่องแต่ยังไม่ถึงเซิร์ฟเวอร์
    final serverIds = {for (final s in list.value?.data ?? const []) s['id']};
    final localOpens = [
      for (final o in ops)
        if (o.kind == 'openShift' && o.status == 'pending')
          if (jsonDecode(o.body!) case final Map<String, dynamic> b when b['branchId'] == branchId && !serverIds.contains(b['id'])) b,
    ];

    return RefreshIndicator(
      onRefresh: () async {
        await ref.read(syncProvider.notifier).flush();
        ref.invalidate(shiftListProvider(args));
        ref.invalidate(setupProvider(branchId));
      },
      child: AsyncBody(
        value: list,
        onRetry: () => ref.invalidate(shiftListProvider(args)),
        builder: (fetched) {
          final shifts = fetched.data.cast<Map<String, dynamic>>();
          final openShift = shifts.where((s) => s['status'] == 'open').firstOrNull ?? localOpens.firstOrNull;
          return MaxWidth(
            width: 900,
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                CacheBanner(fetched: fetched),
                if (openShift != null)
                  _CurrentShiftCard(shift: openShift, local: localOpens.contains(openShift))
                else
                  _OpenShiftCard(branchId: branchId, setup: setup.value?.data, shifts: shifts),
                SectionTitle('กะย้อนหลัง $_days วัน'),
                for (final b in localOpens)
                  if (b != openShift)
                    Card(child: ListTile(title: Text('กะ ${b['shiftNo']} · ${thaiDate(b['businessDate'] as String)}'), subtitle: const Text('รอส่งขึ้นระบบ'))),
                if (shifts.isEmpty && localOpens.isEmpty)
                  const Padding(padding: EdgeInsets.all(24), child: Center(child: Text('ยังไม่มีกะในช่วงนี้'))),
                for (final s in shifts) _ShiftTile(shift: s),
                const SizedBox(height: 8),
                if (_days < 60)
                  Center(
                    child: TextButton(onPressed: () => setState(() => _days = _days == 7 ? 31 : 60), child: const Text('ดูย้อนหลังเพิ่ม')),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _CurrentShiftCard extends StatelessWidget {
  const _CurrentShiftCard({required this.shift, required this.local});
  final Map<String, dynamic> shift;
  final bool local;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final closed = shift['closedCount'] as int? ?? 0;
    final total = shift['nozzleCount'] as int? ?? 0;
    return Card(
      color: theme.colorScheme.primaryContainer,
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.timelapse, color: theme.colorScheme.onPrimaryContainer),
                const SizedBox(width: 8),
                Expanded(
                  child: Text('กะที่กำลังทำงาน', style: theme.textTheme.titleMedium?.copyWith(color: theme.colorScheme.onPrimaryContainer)),
                ),
                if (local) const Chip(label: Text('รอส่ง'), visualDensity: VisualDensity.compact),
              ],
            ),
            const SizedBox(height: 8),
            Text('กะ ${shift['shiftNo']} · ${thaiDate(shift['businessDate'] as String, weekday: true)}',
                style: theme.textTheme.headlineSmall?.copyWith(color: theme.colorScheme.onPrimaryContainer)),
            if (!local) Text('จดปลายกะแล้ว $closed/$total หัวจ่าย · เปิดโดย ${shift['openedByName'] ?? '-'}'),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: () => context.go('/shifts/${shift['id']}'),
              icon: const Icon(Icons.edit_note),
              label: const Text('จดมิเตอร์ / ปิดกะ'),
            ),
          ],
        ),
      ),
    );
  }
}

class _OpenShiftCard extends ConsumerStatefulWidget {
  const _OpenShiftCard({required this.branchId, required this.setup, required this.shifts});
  final String branchId;
  final Map<String, dynamic>? setup;
  final List<Map<String, dynamic>> shifts;

  @override
  ConsumerState<_OpenShiftCard> createState() => _OpenShiftCardState();
}

class _OpenShiftCardState extends ConsumerState<_OpenShiftCard> {
  bool _busy = false;

  /// กะถัดไป: ต่อจากกะล่าสุดของวันนี้ หรือกะ 1 ของวันใหม่
  (String, int) _next() {
    final today = (widget.setup?['today'] as String?) ?? todayIso();
    final last = widget.setup?['lastShift'] as Map<String, dynamic>?;
    final todays = widget.shifts.where((s) => s['businessDate'] == today).map((s) => s['shiftNo'] as int);
    var no = todays.isEmpty ? 1 : todays.reduce((a, b) => a > b ? a : b) + 1;
    if (last != null && last['businessDate'] == today && (last['shiftNo'] as int) >= no) no = (last['shiftNo'] as int) + 1;
    return (today, no.clamp(1, 9));
  }

  Future<void> _open() async {
    if (widget.setup == null) {
      showMessage(context, 'ยังไม่มีข้อมูลตั้งค่าสาขาในเครื่อง ต้องต่อเน็ตครั้งแรกก่อน', error: true);
      return;
    }
    var (date, no) = _next();
    final picked = await showDialog<(String, int)>(
      context: context,
      builder: (c) => _OpenShiftDialog(date: date, shiftNo: no),
    );
    if (picked == null) return;
    setState(() => _busy = true);
    final id = await ref.read(shiftActionsProvider).openShift(branchId: widget.branchId, businessDate: picked.$1, shiftNo: picked.$2);
    if (mounted) {
      setState(() => _busy = false);
      context.go('/shifts/$id');
    }
  }

  @override
  Widget build(BuildContext context) {
    final nozzles = (widget.setup?['nozzles'] as List?)?.length ?? 0;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('ยังไม่มีกะที่เปิดอยู่', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            Text(widget.setup == null ? 'กำลังโหลดตั้งค่าสาขา…' : 'หัวจ่าย $nozzles หัว · ระบบจะเติมเลขมิเตอร์ต้นกะจากปลายกะก่อนหน้าให้'),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _busy || nozzles == 0 ? null : _open,
              icon: const Icon(Icons.play_arrow),
              label: const Text('เปิดกะใหม่'),
            ),
          ],
        ),
      ),
    );
  }
}

class _OpenShiftDialog extends StatefulWidget {
  const _OpenShiftDialog({required this.date, required this.shiftNo});
  final String date;
  final int shiftNo;

  @override
  State<_OpenShiftDialog> createState() => _OpenShiftDialogState();
}

class _OpenShiftDialogState extends State<_OpenShiftDialog> {
  late String _date = widget.date;
  late int _no = widget.shiftNo;

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('เปิดกะใหม่'),
      content: Column(
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
                firstDate: DateTime.parse(_date).subtract(const Duration(days: 7)),
                lastDate: DateTime.parse(_date).add(const Duration(days: 1)),
              );
              if (d != null) setState(() => _date = isoDateOf(d));
            },
          ),
          const SizedBox(height: 8),
          SegmentedButton<int>(
            segments: [for (var i = 1; i <= 4; i++) ButtonSegment(value: i, label: Text('กะ $i'))],
            selected: {_no.clamp(1, 4)},
            onSelectionChanged: (v) => setState(() => _no = v.first),
          ),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('ยกเลิก')),
        FilledButton(onPressed: () => Navigator.pop(context, (_date, _no)), child: const Text('เปิดกะ')),
      ],
    );
  }
}

class _ShiftTile extends StatelessWidget {
  const _ShiftTile({required this.shift});
  final Map<String, dynamic> shift;

  @override
  Widget build(BuildContext context) {
    final diff = shift['diffSatang'] as int;
    final status = shift['status'] as String;
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        onTap: () => context.go('/shifts/${shift['id']}'),
        title: Text('กะ ${shift['shiftNo']} · ${thaiDate(shift['businessDate'] as String, weekday: true)}'),
        subtitle: Wrap(
          spacing: 12,
          children: [
            Text('${fmtLitresApi(shift['soldLitres'] as String)} ลิตร'),
            Text('${fmtBaht(shift['expectedSatang'] as int)} บาท'),
            if (status != 'open') DiffText(diff),
          ],
        ),
        trailing: StatusChip(status),
      ),
    );
  }
}

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/format.dart';
import '../../core/responsive.dart';
import '../../core/session.dart';
import '../../core/units.dart';
import '../../widgets/bar_chart.dart';
import '../../widgets/common.dart';
import '../data.dart';

enum _Range { today, yesterday, week, month }

/// Dashboard เจ้าของ — "เมื่อวานเงินกับน้ำมันครบไหม"
class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key});

  @override
  ConsumerState<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends ConsumerState<DashboardScreen> {
  _Range _range = _Range.yesterday;
  String? _branchId; // null = ทุกสาขา

  (String, String) _dates() {
    final t = todayIso();
    return switch (_range) {
      _Range.today => (t, t),
      _Range.yesterday => (addDays(t, -1), addDays(t, -1)),
      _Range.week => (addDays(t, -6), t),
      _Range.month => (addDays(t, -29), t),
    };
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider)!;
    final (from, to) = _dates();
    final args = RangeArgs(_branchId, from, to);
    final data = ref.watch(dashboardProvider(args));

    final filters = Wrap(
      spacing: 12,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        SegmentedButton<_Range>(
          showSelectedIcon: false,
          segments: const [
            ButtonSegment(value: _Range.today, label: Text('วันนี้')),
            ButtonSegment(value: _Range.yesterday, label: Text('เมื่อวาน')),
            ButtonSegment(value: _Range.week, label: Text('7 วัน')),
            ButtonSegment(value: _Range.month, label: Text('30 วัน')),
          ],
          selected: {_range},
          onSelectionChanged: (v) => setState(() => _range = v.first),
        ),
        if (session.branches.length > 1)
          DropdownButton<String?>(
            value: _branchId,
            items: [
              const DropdownMenuItem(value: null, child: Text('ทุกสาขา')),
              for (final b in session.branches) DropdownMenuItem(value: b.id, child: Text(b.name)),
            ],
            onChanged: (v) => setState(() => _branchId = v),
          ),
      ],
    );

    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(dashboardProvider(args)),
      child: AsyncBody(
        value: data,
        onRetry: () => ref.invalidate(dashboardProvider(args)),
        builder: (fetched) {
          final d = fetched.data;
          final size = context.windowSize;
          final cards = _Cards(d: d, multiBranch: (d['branches'] as List).length > 1);
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              CacheBanner(fetched: fetched),
              filters,
              const SizedBox(height: 4),
              Text(from == to ? thaiDate(from, weekday: true) : '${thaiDate(from)} – ${thaiDate(to)}', style: Theme.of(context).textTheme.bodySmall),
              const SizedBox(height: 12),
              cards.kpis(context),
              const SizedBox(height: 16),
              if (size == WindowSize.expanded)
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(flex: 2, child: Column(children: [cards.salesChart(context), const SizedBox(height: 16), cards.cashByShift(context)])),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(children: [
                        cards.alerts(context),
                        const SizedBox(height: 16),
                        cards.byFuel(context),
                        const SizedBox(height: 16),
                        cards.tanks(context),
                        const SizedBox(height: 16),
                        cards.cashByAttendant(context),
                      ]),
                    ),
                  ],
                )
              else if (size == WindowSize.medium) ...[
                cards.alerts(context),
                const SizedBox(height: 16),
                cards.salesChart(context),
                const SizedBox(height: 16),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(child: cards.byFuel(context)),
                    const SizedBox(width: 16),
                    Expanded(child: cards.tanks(context)),
                  ],
                ),
                const SizedBox(height: 16),
                cards.cashByAttendant(context),
                const SizedBox(height: 16),
                cards.cashByShift(context),
              ] else ...[
                cards.alerts(context),
                const SizedBox(height: 16),
                cards.salesChart(context),
                const SizedBox(height: 16),
                cards.byFuel(context),
                const SizedBox(height: 16),
                cards.tanks(context),
                const SizedBox(height: 16),
                cards.cashByAttendant(context),
                const SizedBox(height: 16),
                cards.cashByShift(context),
              ],
            ],
          );
        },
      ),
    );
  }
}

class _Cards {
  _Cards({required this.d, required this.multiBranch});
  final Map<String, dynamic> d;
  final bool multiBranch;

  Map<String, dynamic> get totals => d['totals'] as Map<String, dynamic>;
  Map<String, String> get branchNames => {for (final b in d['branches'] as List) b['id'] as String: b['name'] as String};

  Widget _card(BuildContext context, String title, Widget child, {Widget? trailing}) => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(children: [
                Expanded(child: Text(title, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600))),
                ?trailing,
              ]),
              const SizedBox(height: 12),
              child,
            ],
          ),
        ),
      );

  Widget kpis(BuildContext context) {
    final diff = totals['cashDiffSatang'] as int;
    final tiles = [
      _Kpi(label: 'ยอดขาย (บาท)', value: fmtBaht(totals['salesSatang'] as int), icon: Icons.payments_outlined),
      _Kpi(label: 'ลิตรที่ขาย', value: fmtLitresApi(totals['soldLitres'] as String), icon: Icons.local_gas_station_outlined),
      _Kpi(
        label: 'เงินขาด/เกิน',
        valueWidget: DiffText(diff, style: Theme.of(context).textTheme.headlineSmall),
        icon: diff < 0 ? Icons.trending_down : Icons.check_circle_outline,
      ),
      _Kpi(
        label: 'กะที่ปิดแล้ว',
        value: '${totals['shiftCount']}',
        sub: [
          if ((totals['pendingApproval'] as int) > 0) 'รอยืนยัน ${totals['pendingApproval']}',
          if ((totals['openShifts'] as int) > 0) 'เปิดอยู่ ${totals['openShifts']}',
        ].join(' · '),
        icon: Icons.receipt_long_outlined,
      ),
    ];
    return LayoutBuilder(builder: (context, c) {
      final cols = c.maxWidth > 900 ? 4 : 2;
      final w = (c.maxWidth - (cols - 1) * 12) / cols;
      return Wrap(spacing: 12, runSpacing: 12, children: [for (final t in tiles) SizedBox(width: w, child: t)]);
    });
  }

  Widget alerts(BuildContext context) {
    final list = (d['alerts'] as List).cast<Map<String, dynamic>>();
    final scheme = Theme.of(context).colorScheme;
    return _card(
      context,
      'ต้องดูตอนนี้',
      list.isEmpty
          ? const ListTile(leading: Icon(Icons.check_circle_outline), title: Text('ไม่มีเรื่องผิดปกติ'))
          : Column(
              children: [
                for (final a in list.take(8))
                  ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(
                      switch (a['severity']) { 'critical' => Icons.error, 'warning' => Icons.warning_amber_rounded, _ => Icons.info_outline },
                      color: switch (a['severity']) { 'critical' => scheme.error, 'warning' => Colors.orange.shade800, _ => scheme.primary },
                    ),
                    title: Text(a['message'] as String),
                    onTap: a['kind'] == 'pending_approval' || a['kind'] == 'stale_shift'
                        ? () => context.go('/shifts/${a['refId']}')
                        : (a['kind'] as String).contains('dip') || a['kind'] == 'reorder' || a['kind'] == 'variance'
                            ? () => context.go('/stock')
                            : null,
                  ),
              ],
            ),
    );
  }

  Widget salesChart(BuildContext context) {
    final daily = (d['daily'] as List).cast<Map<String, dynamic>>();
    return _card(
      context,
      'ยอดขายรายวัน (บาท)',
      SimpleBarChart(
        labels: [for (final x in daily) shortDate(x['date'] as String)],
        values: [for (final x in daily) x['salesSatang'] as int],
        format: (v) => fmtBahtShort(v),
      ),
    );
  }

  Widget byFuel(BuildContext context) {
    final rows = (d['byFuel'] as List).cast<Map<String, dynamic>>();
    return _card(
      context,
      'ลิตรตามชนิดน้ำมัน',
      rows.isEmpty
          ? const Text('ยังไม่มีข้อมูล')
          : HBarList(items: [
              for (final f in rows)
                (
                  label: f['name'] as String,
                  value: parseLitres(f['soldLitres'] as String),
                  valueText: '${fmtLitresApi(f['soldLitres'] as String)} ลิตร',
                  swatch: _hex(f['color'] as String?),
                ),
            ]),
    );
  }

  Widget tanks(BuildContext context) {
    final rows = (d['tanks'] as List).cast<Map<String, dynamic>>();
    final scheme = Theme.of(context).colorScheme;
    return _card(
      context,
      'สต็อกคงเหลือ',
      Column(
        children: [
          if (rows.isEmpty) const Text('ยังไม่ได้ตั้งค่าถัง'),
          for (final t in rows)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    Expanded(child: Text('${multiBranch ? '${branchNames[t['branchId']]} · ' : ''}${t['name']}')),
                    if (t['belowReorder'] == true) ...[
                      Icon(Icons.error, size: 16, color: scheme.error),
                      const SizedBox(width: 4),
                      Text('ถึงจุดสั่ง', style: TextStyle(color: scheme.error, fontWeight: FontWeight.w600)),
                      const SizedBox(width: 8),
                    ],
                    Text(t['bookLitres'] == null ? 'ยังไม่วัด' : '${fmtLitresApi(t['bookLitres'] as String)} ล. (${t['fillPercent']}%)'),
                  ]),
                  const SizedBox(height: 4),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: LinearProgressIndicator(
                      value: ((double.tryParse(t['fillPercent'] as String? ?? '') ?? 0) / 100).clamp(0, 1),
                      minHeight: 8,
                      color: t['belowReorder'] == true ? scheme.error : scheme.primary,
                      backgroundColor: scheme.surfaceContainerHighest,
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget cashByAttendant(BuildContext context) {
    final rows = (d['cashByAttendant'] as List).cast<Map<String, dynamic>>();
    return _card(
      context,
      'เงินขาด/เกินรายพนักงาน',
      rows.isEmpty
          ? const Text('ยังไม่มีข้อมูล')
          : Column(
              children: [
                for (final a in rows)
                  ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.person_outline),
                    title: Text(a['name'] as String),
                    subtitle: Text('${a['shifts']} กะ · ขาด ${a['shortShifts']} กะ'),
                    trailing: DiffText(a['diffSatang'] as int),
                  ),
              ],
            ),
    );
  }

  Widget cashByShift(BuildContext context) {
    final rows = (d['cashByShift'] as List).cast<Map<String, dynamic>>();
    return _card(
      context,
      'ยอดรายกะ',
      rows.isEmpty
          ? const Text('ยังไม่มีกะที่ปิดแล้วในช่วงนี้')
          : SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: DataTable(
                columnSpacing: 24,
                showCheckboxColumn: false,
                columns: [
                  const DataColumn(label: Text('วันที่')),
                  const DataColumn(label: Text('กะ')),
                  if (multiBranch) const DataColumn(label: Text('สาขา')),
                  const DataColumn(label: Text('ควรได้'), numeric: true),
                  const DataColumn(label: Text('ส่งจริง'), numeric: true),
                  const DataColumn(label: Text('ขาด/เกิน'), numeric: true),
                  const DataColumn(label: Text('สถานะ')),
                ],
                rows: [
                  for (final s in rows.take(60))
                    DataRow(
                      onSelectChanged: (_) => context.go('/shifts/${s['shiftId']}'),
                      cells: [
                        DataCell(Text(thaiDate(s['businessDate'] as String))),
                        DataCell(Text('${s['shiftNo']}')),
                        if (multiBranch) DataCell(Text(branchNames[s['branchId']] ?? '')),
                        DataCell(Text(fmtBaht(s['expectedSatang'] as int))),
                        DataCell(Text(fmtBaht(s['collectedSatang'] as int))),
                        DataCell(DiffText(s['diffSatang'] as int)),
                        DataCell(StatusChip(s['status'] as String)),
                      ],
                    ),
                ],
              ),
            ),
    );
  }

  static Color? _hex(String? hex) => hex == null || hex.length != 7 ? null : Color(int.parse('FF${hex.substring(1)}', radix: 16));
}

class _Kpi extends StatelessWidget {
  const _Kpi({required this.label, this.value, this.valueWidget, required this.icon, this.sub});
  final String label;
  final String? value;
  final Widget? valueWidget;
  final IconData icon;
  final String? sub;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Icon(icon, size: 18, color: theme.colorScheme.onSurfaceVariant),
              const SizedBox(width: 6),
              Expanded(child: Text(label, style: theme.textTheme.bodySmall)),
            ]),
            const SizedBox(height: 8),
            valueWidget ??
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text(value ?? '-', style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700)),
                ),
            if (sub != null && sub!.isNotEmpty) Text(sub!, style: theme.textTheme.bodySmall),
          ],
        ),
      ),
    );
  }
}

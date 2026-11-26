import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/responsive.dart';
import '../../core/session.dart';
import '../../core/sync.dart';

class _Dest {
  const _Dest(this.path, this.label, this.icon, this.selectedIcon);
  final String path;
  final String label;
  final IconData icon;
  final IconData selectedIcon;
}

/// โครงหน้าจอหลัก — ปรับตามขนาดจอ: มือถือใช้แถบล่าง แท็บเล็ต/คอมใช้แถบด้านข้าง
class HomeShell extends ConsumerWidget {
  const HomeShell({super.key, required this.location, required this.child});
  final String location;
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    if (session == null) return const SizedBox.shrink();
    final dests = [
      if (session.isManager) const _Dest('/dashboard', 'ภาพรวม', Icons.insights_outlined, Icons.insights),
      const _Dest('/shifts', 'ปิดกะ', Icons.receipt_long_outlined, Icons.receipt_long),
      const _Dest('/stock', 'สต็อกถัง', Icons.propane_tank_outlined, Icons.propane_tank),
      const _Dest('/settings', 'ตั้งค่า', Icons.settings_outlined, Icons.settings),
    ];
    var index = dests.indexWhere((d) => location == d.path || location.startsWith('${d.path}/'));
    if (index < 0) index = 0;

    final body = session.branchId == null && location != '/settings' && location != '/sync' && location != '/dashboard'
        ? const _BranchPicker()
        : child;

    final appBar = AppBar(
      title: _BranchTitle(session: session),
      actions: const [_SyncBadge(), SizedBox(width: 8)],
    );

    final size = context.windowSize;
    if (size == WindowSize.compact) {
      return Scaffold(
        appBar: appBar,
        body: body,
        bottomNavigationBar: NavigationBar(
          selectedIndex: index,
          onDestinationSelected: (i) => context.go(dests[i].path),
          destinations: [
            for (final d in dests) NavigationDestination(icon: Icon(d.icon), selectedIcon: Icon(d.selectedIcon), label: d.label),
          ],
        ),
      );
    }
    return Scaffold(
      appBar: appBar,
      body: Row(
        children: [
          NavigationRail(
            extended: size == WindowSize.expanded,
            minExtendedWidth: 200,
            selectedIndex: index,
            labelType: size == WindowSize.expanded ? NavigationRailLabelType.none : NavigationRailLabelType.all,
            onDestinationSelected: (i) => context.go(dests[i].path),
            leading: size == WindowSize.expanded
                ? Padding(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                    child: Text(session.tenantName, style: Theme.of(context).textTheme.titleSmall),
                  )
                : null,
            destinations: [
              for (final d in dests) NavigationRailDestination(icon: Icon(d.icon), selectedIcon: Icon(d.selectedIcon), label: Text(d.label)),
            ],
          ),
          const VerticalDivider(width: 1),
          Expanded(child: body),
        ],
      ),
    );
  }
}

class _BranchTitle extends ConsumerWidget {
  const _BranchTitle({required this.session});
  final Session session;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final branch = session.branch;
    final title = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(branch?.name ?? session.tenantName, overflow: TextOverflow.ellipsis),
        Text('${session.displayName} · ${session.roleLabel}', style: Theme.of(context).textTheme.bodySmall),
      ],
    );
    if (session.branches.length <= 1) return title;
    return PopupMenuButton<String>(
      tooltip: 'เปลี่ยนสาขา',
      onSelected: (id) => ref.read(sessionProvider.notifier).selectBranch(id),
      itemBuilder: (_) => [
        for (final b in session.branches)
          CheckedPopupMenuItem(value: b.id, checked: b.id == session.branchId, child: Text(b.name)),
      ],
      child: Row(mainAxisSize: MainAxisSize.min, children: [Flexible(child: title), const Icon(Icons.arrow_drop_down)]),
    );
  }
}

/// แสดงสถานะซิงก์: ออนไลน์/ออฟไลน์ และจำนวนรายการรอส่ง
class _SyncBadge extends ConsumerWidget {
  const _SyncBadge();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(syncProvider);
    final scheme = Theme.of(context).colorScheme;
    final IconData icon;
    final Color color;
    final String label;
    if (s.failed > 0) {
      icon = Icons.error_outline;
      color = scheme.error;
      label = 'ส่งไม่ผ่าน ${s.failed}';
    } else if (!s.online) {
      icon = Icons.cloud_off;
      color = Colors.orange.shade800;
      label = s.pending > 0 ? 'ออฟไลน์ · รอส่ง ${s.pending}' : 'ออฟไลน์';
    } else if (s.pending > 0) {
      icon = Icons.cloud_upload_outlined;
      color = scheme.primary;
      label = 'รอส่ง ${s.pending}';
    } else {
      icon = Icons.cloud_done_outlined;
      color = Colors.green.shade700;
      label = 'ซิงก์แล้ว';
    }
    return TextButton.icon(
      onPressed: () => context.go('/sync'),
      icon: s.syncing ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : Icon(icon, color: color),
      label: Text(context.isCompact && s.pending == 0 && s.failed == 0 && s.online ? '' : label, style: TextStyle(color: color)),
    );
  }
}

class _BranchPicker extends ConsumerWidget {
  const _BranchPicker();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(sessionProvider)!;
    if (s.branches.isEmpty) {
      return const Center(child: Padding(padding: EdgeInsets.all(24), child: Text('บัญชีนี้ยังไม่ได้รับสิทธิ์สาขาใด กรุณาติดต่อเจ้าของปั๊ม')));
    }
    return MaxWidth(
      width: 480,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('เลือกสาขา', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 12),
          for (final b in s.branches)
            Card(
              child: ListTile(
                leading: const Icon(Icons.store),
                title: Text(b.name),
                subtitle: Text('รหัส ${b.code}'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => ref.read(sessionProvider.notifier).selectBranch(b.id),
              ),
            ),
        ],
      ),
    );
  }
}

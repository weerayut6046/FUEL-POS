import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/format.dart';
import '../../core/responsive.dart';
import '../../core/sync.dart';
import '../../widgets/common.dart';

/// รายการที่บันทึกในเครื่องแล้วรอส่งขึ้นระบบ / ส่งไม่ผ่าน
class SyncScreen extends ConsumerWidget {
  const SyncScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(syncProvider);
    final ops = ref.watch(outboxProvider);
    final notifier = ref.read(syncProvider.notifier);
    return MaxWidth(
      width: 760,
      child: AsyncBody(
        value: ops,
        builder: (list) {
          final failed = list.where((o) => o.status == 'failed').toList();
          final pending = list.where((o) => o.status == 'pending').toList();
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Card(
                child: ListTile(
                  leading: Icon(state.online ? Icons.cloud_done_outlined : Icons.cloud_off, size: 36),
                  title: Text(state.online ? 'ออนไลน์' : 'ออฟไลน์ — ข้อมูลเก็บในเครื่องไว้แล้ว จะส่งให้อัตโนมัติเมื่อเน็ตกลับมา'),
                  subtitle: Text([
                    'รอส่ง ${pending.length} · ส่งไม่ผ่าน ${failed.length}',
                    if (state.lastSyncAt != null) 'ส่งล่าสุด ${thaiDateTime(state.lastSyncAt!.toIso8601String())}',
                    if (state.lastError != null) state.lastError!,
                  ].join('\n')),
                  trailing: FilledButton.tonal(
                    onPressed: state.syncing ? null : notifier.flush,
                    child: state.syncing ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('ส่งตอนนี้'),
                  ),
                ),
              ),
              if (failed.isNotEmpty) ...[
                SectionTitle(
                  'ส่งไม่ผ่าน (${failed.length})',
                  trailing: TextButton(onPressed: notifier.retryFailed, child: const Text('ลองส่งใหม่ทั้งหมด')),
                ),
                const Text('ระบบปฏิเสธรายการเหล่านี้ เช่น กะถูกยืนยันไปแล้ว — ตรวจแล้วลองใหม่ หรือทิ้งรายการ'),
                const SizedBox(height: 8),
                for (final o in failed)
                  Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    child: ListTile(
                      leading: Icon(Icons.error_outline, color: Theme.of(context).colorScheme.error),
                      title: Text(o.label),
                      subtitle: Text('${thaiDateTime(o.createdAt.toIso8601String())}\n${o.lastError ?? ''}'),
                      isThreeLine: true,
                      trailing: IconButton(
                        tooltip: 'ทิ้งรายการ',
                        icon: const Icon(Icons.delete_outline),
                        onPressed: () async {
                          final ok = await showDialog<bool>(
                            context: context,
                            builder: (c) => AlertDialog(
                              title: const Text('ทิ้งรายการนี้?'),
                              content: Text('"${o.label}" จะไม่ถูกส่งขึ้นระบบ'),
                              actions: [
                                TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('ยกเลิก')),
                                FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('ทิ้ง')),
                              ],
                            ),
                          );
                          if (ok == true) await notifier.discard(o.seq);
                        },
                      ),
                    ),
                  ),
              ],
              SectionTitle('รอส่ง (${pending.length})'),
              if (pending.isEmpty) const Padding(padding: EdgeInsets.all(16), child: Text('ไม่มีรายการค้าง ✓')),
              for (final o in pending)
                ListTile(
                  dense: true,
                  leading: Icon(o.kind == 'photo' ? Icons.photo_outlined : Icons.schedule_send_outlined),
                  title: Text(o.label),
                  subtitle: Text('${thaiDateTime(o.createdAt.toIso8601String())}${o.attempts > 0 ? ' · ลองแล้ว ${o.attempts} ครั้ง' : ''}'),
                ),
            ],
          );
        },
      ),
    );
  }
}

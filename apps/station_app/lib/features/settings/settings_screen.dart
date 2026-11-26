import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/responsive.dart';
import '../../core/session.dart';
import '../../widgets/common.dart';
import 'settings_pages.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(sessionProvider)!;
    void open(Widget page) => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => page));
    final branch = s.branch;
    return MaxWidth(
      width: 760,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: ListTile(
              leading: const CircleAvatar(child: Icon(Icons.person)),
              title: Text(s.displayName),
              subtitle: Text('${s.roleLabel} · ${s.tenantName} (รหัสปั๊ม ${s.tenantSlug})'),
            ),
          ),
          if (s.isManager && branch != null) ...[
            SectionTitle('สาขา ${branch.name}'),
            Card(
              child: Column(children: [
                ListTile(
                  leading: const Icon(Icons.sell_outlined),
                  title: const Text('ราคาน้ำมัน'),
                  subtitle: const Text('ประกาศราคาใหม่ · ประวัติราคา'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => open(PricesPage(branchId: branch.id)),
                ),
                ListTile(
                  leading: const Icon(Icons.propane_tank_outlined),
                  title: const Text('ถังและตารางแปลงระดับ'),
                  subtitle: const Text('ความจุ · จุดสั่ง · ตารางแปลง มม. เป็นลิตร'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => open(TanksPage(branchId: branch.id)),
                ),
                ListTile(
                  leading: const Icon(Icons.local_gas_station_outlined),
                  title: const Text('หัวจ่าย'),
                  subtitle: const Text('ตู้ หัวจ่าย ชนิดน้ำมัน ถังที่ดูด'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => open(NozzlesPage(branchId: branch.id)),
                ),
              ]),
            ),
          ],
          if (s.isManager) ...[
            const SectionTitle('ผู้ใช้และการแจ้งเตือน'),
            Card(
              child: Column(children: [
                ListTile(
                  leading: const Icon(Icons.group_outlined),
                  title: const Text('ผู้ใช้และสิทธิ์'),
                  subtitle: Text(s.isOwner ? 'เจ้าของ · ผู้จัดการ · พนักงาน' : 'พนักงานหน้าลานในสาขาของคุณ'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => open(const UsersPage()),
                ),
                ListTile(
                  leading: const Icon(Icons.chat_outlined),
                  title: const Text('แจ้งเตือนทาง LINE'),
                  subtitle: const Text('เงินขาดเกิน · น้ำมันใกล้หมด · สรุปประจำวัน'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => open(const LinePage()),
                ),
              ]),
            ),
          ],
          if (s.isOwner) ...[
            const SectionTitle('ปั๊ม'),
            Card(
              child: Column(children: [
                ListTile(
                  leading: const Icon(Icons.tune),
                  title: const Text('เกณฑ์การแจ้งเตือน'),
                  subtitle: const Text('เงินขาดเกิน · น้ำมันขาดเกิน % · เวลาสรุปประจำวัน'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => open(const TenantSettingsPage()),
                ),
                ListTile(
                  leading: const Icon(Icons.store_outlined),
                  title: const Text('สาขา'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => open(const BranchesPage()),
                ),
                ListTile(
                  leading: const Icon(Icons.history),
                  title: const Text('ประวัติการแก้ไขตั้งค่า'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => open(const AuditPage()),
                ),
              ]),
            ),
          ],
          const SectionTitle('บัญชี'),
          Card(
            child: Column(children: [
              ListTile(
                leading: const Icon(Icons.password),
                title: const Text('เปลี่ยนรหัสผ่าน'),
                onTap: () => showDialog<void>(context: context, builder: (_) => const ChangePasswordDialog()),
              ),
              ListTile(
                leading: const Icon(Icons.logout),
                title: const Text('ออกจากระบบ'),
                onTap: () async {
                  final ok = await showDialog<bool>(
                    context: context,
                    builder: (c) => AlertDialog(
                      title: const Text('ออกจากระบบ?'),
                      content: const Text('รายการที่ยังไม่ได้ส่งจะยังอยู่ในเครื่อง และจะส่งเมื่อเข้าสู่ระบบด้วยบัญชีเดิม'),
                      actions: [
                        TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('ยกเลิก')),
                        FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('ออกจากระบบ')),
                      ],
                    ),
                  );
                  if (ok == true) await ref.read(sessionProvider.notifier).logout();
                },
              ),
            ]),
          ),
        ],
      ),
    );
  }
}

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:material_ui/material_ui.dart';

import 'app.dart';
import 'core/local_db.dart';
import 'core/session.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('th');
  final db = LocalDb.open();
  final container = ProviderContainer(overrides: [localDbProvider.overrideWithValue(db)]);
  // เปิดแอปแล้วเข้าระบบเดิมได้เลย แม้ออฟไลน์
  await container.read(sessionProvider.notifier).restore();
  runApp(UncontrolledProviderScope(container: container, child: const StationApp()));
}

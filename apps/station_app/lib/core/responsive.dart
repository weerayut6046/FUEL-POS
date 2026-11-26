/// 3 ช่วงขนาดหน้าจอตาม Material Design
///
///   มือถือ     < 600 dp   พนักงานหน้าลาน   ทำทีละขั้น ปุ่มใหญ่ กดได้ด้วยนิ้วเดียว
///   แท็บเล็ต   600–840    ผู้จัดการปั๊ม     รายการหัวจ่ายซ้าย รายละเอียดขวา
///   คอมพิวเตอร์ > 840     เจ้าของ           Dashboard หลายคอลัมน์ ตารางเต็มความกว้าง
library;

import 'package:material_ui/material_ui.dart';

enum WindowSize { compact, medium, expanded }

WindowSize windowSizeOf(BuildContext context) {
  final w = MediaQuery.sizeOf(context).width;
  if (w < 600) return WindowSize.compact;
  if (w <= 840) return WindowSize.medium;
  return WindowSize.expanded;
}

extension WindowSizeX on BuildContext {
  WindowSize get windowSize => windowSizeOf(this);
  bool get isCompact => windowSize == WindowSize.compact;
  bool get isExpanded => windowSize == WindowSize.expanded;
}

/// จัดเนื้อหาให้กว้างไม่เกินกำหนดบนจอใหญ่
class MaxWidth extends StatelessWidget {
  const MaxWidth({super.key, this.width = 1200, required this.child});
  final double width;
  final Widget child;

  @override
  Widget build(BuildContext context) => Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(constraints: BoxConstraints(maxWidth: width), child: child),
      );
}

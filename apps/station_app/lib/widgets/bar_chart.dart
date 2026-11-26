import 'dart:math' as math;

import 'package:material_ui/material_ui.dart';

/// กราฟแท่งชุดเดียว (ยอดขายรายวัน) — สีเดียว ไม่มี legend (ชื่อกราฟบอกแล้ว)
/// แท่งบาง มุมบนโค้ง 4px ยึดฐาน · เส้นตารางจาง · แตะแท่งเพื่อดูค่า
class SimpleBarChart extends StatefulWidget {
  const SimpleBarChart({super.key, required this.labels, required this.values, required this.format, this.height = 220});

  final List<String> labels;
  final List<int> values;
  final String Function(int) format;
  final double height;

  @override
  State<SimpleBarChart> createState() => _SimpleBarChartState();
}

class _SimpleBarChartState extends State<SimpleBarChart> {
  int? _selected;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (widget.values.isEmpty) {
      return SizedBox(height: widget.height, child: const Center(child: Text('ยังไม่มีข้อมูลในช่วงนี้')));
    }
    return SizedBox(
      height: widget.height,
      child: LayoutBuilder(builder: (context, c) {
        const left = 0.0;
        const bottom = 24.0;
        const top = 28.0;
        final n = widget.values.length;
        final slot = (c.maxWidth - left) / n;
        int? hit(Offset p) {
          final i = ((p.dx - left) / slot).floor();
          return i >= 0 && i < n ? i : null;
        }

        return GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTapDown: (d) => setState(() => _selected = hit(d.localPosition)),
          child: MouseRegion(
            onHover: (e) {
              final i = hit(e.localPosition);
              if (i != _selected) setState(() => _selected = i);
            },
            onExit: (_) => setState(() => _selected = null),
            child: Semantics(
              label: 'กราฟแท่ง ${[for (var i = 0; i < n; i++) '${widget.labels[i]} ${widget.format(widget.values[i])}'].join(', ')}',
              child: CustomPaint(
                size: Size(c.maxWidth, widget.height),
                painter: _BarPainter(
                  values: widget.values,
                  labels: widget.labels,
                  selected: _selected,
                  format: widget.format,
                  bar: theme.colorScheme.primary,
                  barMuted: theme.colorScheme.primary.withValues(alpha: 0.45),
                  grid: theme.colorScheme.outlineVariant.withValues(alpha: 0.6),
                  text: theme.colorScheme.onSurfaceVariant,
                  strong: theme.colorScheme.onSurface,
                  tooltipBg: theme.colorScheme.inverseSurface,
                  tooltipText: theme.colorScheme.onInverseSurface,
                  top: top,
                  bottom: bottom,
                ),
              ),
            ),
          ),
        );
      }),
    );
  }
}

class _BarPainter extends CustomPainter {
  _BarPainter({
    required this.values,
    required this.labels,
    required this.selected,
    required this.format,
    required this.bar,
    required this.barMuted,
    required this.grid,
    required this.text,
    required this.strong,
    required this.tooltipBg,
    required this.tooltipText,
    required this.top,
    required this.bottom,
  });

  final List<int> values;
  final List<String> labels;
  final int? selected;
  final String Function(int) format;
  final Color bar, barMuted, grid, text, strong, tooltipBg, tooltipText;
  final double top, bottom;

  @override
  void paint(Canvas canvas, Size size) {
    final n = values.length;
    final maxV = math.max(1, values.reduce(math.max));
    final plotH = size.height - top - bottom;
    final slot = size.width / n;
    final barW = math.min(28.0, math.max(4.0, slot - 2)); // ช่องว่างระหว่างแท่งอย่างน้อย 2px
    final base = size.height - bottom;

    // เส้นตาราง 3 เส้น (จาง)
    final gridPaint = Paint()
      ..color = grid
      ..strokeWidth = 1;
    for (var g = 0; g <= 2; g++) {
      final y = base - plotH * g / 2;
      canvas.drawLine(Offset(0, y), Offset(size.width, y), gridPaint);
    }
    _text(canvas, format(maxV), Offset(0, top - 16), text, 11);

    final labelEvery = (n / (size.width / 44)).ceil().clamp(1, n);
    for (var i = 0; i < n; i++) {
      final h = plotH * values[i] / maxV;
      final x = slot * i + (slot - barW) / 2;
      final rect = RRect.fromRectAndCorners(
        Rect.fromLTWH(x, base - h, barW, h),
        topLeft: const Radius.circular(4),
        topRight: const Radius.circular(4),
      );
      canvas.drawRRect(rect, Paint()..color = selected == null || selected == i ? bar : barMuted);
      if (i % labelEvery == 0 || i == n - 1) {
        _text(canvas, labels[i], Offset(slot * i + slot / 2, base + 6), text, 11, center: true);
      }
    }

    final s = selected;
    if (s != null) {
      final label = '${labels[s]}  ${format(values[s])}';
      final tp = _layout(label, tooltipText, 12, bold: true);
      final cx = (slot * s + slot / 2).clamp(tp.width / 2 + 6, size.width - tp.width / 2 - 6);
      final box = Rect.fromCenter(center: Offset(cx, top / 2), width: tp.width + 12, height: tp.height + 8);
      canvas.drawRRect(RRect.fromRectAndRadius(box, const Radius.circular(6)), Paint()..color = tooltipBg);
      tp.paint(canvas, Offset(box.left + 6, box.top + 4));
    }
  }

  TextPainter _layout(String s, Color color, double size, {bool bold = false}) => TextPainter(
        text: TextSpan(text: s, style: TextStyle(color: color, fontSize: size, fontWeight: bold ? FontWeight.w600 : FontWeight.w400)),
        textDirection: TextDirection.ltr,
      )..layout();

  void _text(Canvas canvas, String s, Offset at, Color color, double size, {bool center = false}) {
    final tp = _layout(s, color, size);
    tp.paint(canvas, center ? Offset(at.dx - tp.width / 2, at.dy) : at);
  }

  @override
  bool shouldRepaint(covariant _BarPainter old) => old.values != values || old.selected != selected || old.bar != bar;
}

/// แท่งแนวนอนบอกขนาด (เช่น ลิตรตามชนิดน้ำมัน) — สีเดียว ชื่อเป็นข้อความ มีจุดสีระบุชนิด
class HBarList extends StatelessWidget {
  const HBarList({super.key, required this.items});
  final List<({String label, int value, String valueText, Color? swatch})> items;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final maxV = items.isEmpty ? 1 : math.max(1, items.map((e) => e.value).reduce(math.max));
    return Column(
      children: [
        for (final it in items)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    if (it.swatch != null)
                      Container(width: 10, height: 10, margin: const EdgeInsets.only(right: 8), decoration: BoxDecoration(color: it.swatch, shape: BoxShape.circle)),
                    Expanded(child: Text(it.label)),
                    Text(it.valueText, style: theme.textTheme.titleSmall),
                  ],
                ),
                const SizedBox(height: 4),
                LayoutBuilder(
                  builder: (context, c) => Align(
                    alignment: Alignment.centerLeft,
                    child: Container(
                      width: math.max(4, c.maxWidth * it.value / maxV),
                      height: 10,
                      decoration: BoxDecoration(
                        color: theme.colorScheme.primary,
                        borderRadius: const BorderRadius.horizontal(right: Radius.circular(4)),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

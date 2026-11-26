import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/session.dart';
import '../core/shift_calc.dart';
import '../core/sync.dart';

/// แสดง AsyncValue: กำลังโหลด / ผิดพลาด (กดลองใหม่) / ข้อมูล
class AsyncBody<T> extends StatelessWidget {
  const AsyncBody({super.key, required this.value, required this.builder, this.onRetry});
  final AsyncValue<T> value;
  final Widget Function(T data) builder;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return value.when(
      skipLoadingOnRefresh: true,
      skipLoadingOnReload: true,
      data: builder,
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(e is ApiException && e.isNetwork ? Icons.cloud_off : Icons.error_outline, size: 48),
              const SizedBox(height: 12),
              Text(e is ApiException ? e.message : 'เกิดข้อผิดพลาด: $e', textAlign: TextAlign.center),
              if (onRetry != null) ...[
                const SizedBox(height: 12),
                OutlinedButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: const Text('ลองใหม่')),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// แถบแจ้งว่ากำลังแสดงข้อมูลที่เก็บไว้ในเครื่อง (ออฟไลน์)
class CacheBanner extends StatelessWidget {
  const CacheBanner({super.key, required this.fetched});
  final Fetched<dynamic> fetched;

  @override
  Widget build(BuildContext context) {
    if (!fetched.fromCache) return const SizedBox.shrink();
    final at = fetched.cachedAt;
    return MaterialBanner(
      backgroundColor: Colors.orange.shade50,
      leading: Icon(Icons.cloud_off, color: Colors.orange.shade800),
      content: Text('ออฟไลน์ — แสดงข้อมูลที่เก็บไว้${at == null ? '' : ' เมื่อ ${thaiDateTime(at.toIso8601String())}'}'),
      actions: const [SizedBox.shrink()],
    );
  }
}

class StatusChip extends StatelessWidget {
  const StatusChip(this.status, {super.key, this.pending = false});
  final String status;
  final bool pending;

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (status) {
      'open' => ('กำลังทำงาน', Colors.blue.shade700),
      'submitted' => ('รอยืนยัน', Colors.orange.shade800),
      'approved' => ('ยืนยันแล้ว', Colors.green.shade700),
      _ => (status, Colors.grey),
    };
    return Chip(
      label: Text(pending ? '$label (รอส่ง)' : label),
      labelStyle: TextStyle(color: color, fontWeight: FontWeight.w600),
      side: BorderSide(color: color.withValues(alpha: 0.4)),
      backgroundColor: color.withValues(alpha: 0.08),
      visualDensity: VisualDensity.compact,
    );
  }
}

class IssueTile extends StatelessWidget {
  const IssueTile(this.issue, {super.key, this.dense = false});
  final Issue issue;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final (icon, color) = switch (issue.severity) {
      Severity.error => (Icons.error, scheme.error),
      Severity.warning => (Icons.warning_amber_rounded, Colors.orange.shade800),
      Severity.info => (Icons.info_outline, scheme.primary),
    };
    return ListTile(
      dense: dense,
      visualDensity: VisualDensity.compact,
      leading: Icon(icon, color: color),
      title: Text(issue.message, style: TextStyle(color: issue.severity == Severity.error ? color : null)),
    );
  }
}

/// ตัวเลขเงินขาด/เกิน: แดง = ขาด, เขียว = เกิน
class DiffText extends StatelessWidget {
  const DiffText(this.satang, {super.key, this.style, this.prefix = ''});
  final int satang;
  final TextStyle? style;
  final String prefix;

  @override
  Widget build(BuildContext context) {
    final color = satang < 0 ? Theme.of(context).colorScheme.error : (satang > 0 ? Colors.green.shade700 : null);
    final label = satang == 0 ? 'ครบ' : '${satang < 0 ? 'ขาด' : 'เกิน'} ${_baht(satang.abs())}';
    return Text('$prefix$label', style: (style ?? const TextStyle()).copyWith(color: color, fontWeight: FontWeight.w600));
  }

  static String _baht(int s) {
    final b = s ~/ 100;
    final st = (s % 100).toString().padLeft(2, '0');
    final str = b.toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',');
    return '$str.$st';
  }
}

void showMessage(BuildContext context, String message, {bool error = false}) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Text(message),
      backgroundColor: error ? Theme.of(context).colorScheme.error : null,
      behavior: SnackBarBehavior.floating,
    ));
}

/// เรียก API แล้วแสดงข้อความผิดพลาดภาษาไทย คืน true ถ้าสำเร็จ
Future<bool> runApi(BuildContext context, Future<void> Function() action, {String? success}) async {
  try {
    await action();
    if (success != null && context.mounted) showMessage(context, success);
    return true;
  } on ApiException catch (e) {
    if (context.mounted) {
      final details = e.detailMessages;
      if (details.isEmpty) {
        showMessage(context, e.message, error: true);
      } else {
        await showDialog<void>(
          context: context,
          builder: (c) => AlertDialog(
            title: Text(e.message),
            content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [for (final d in details) ListTile(leading: const Icon(Icons.error_outline), title: Text(d))])),
            actions: [TextButton(onPressed: () => Navigator.pop(c), child: const Text('ตกลง'))],
          ),
        );
      }
    }
    return false;
  }
}

/// ถามเหตุผลการแก้ไขตัวเลข (บังคับตามกติกา: แก้ตัวเลขต้องมีเหตุผล)
Future<String?> askReason(BuildContext context, {String title = 'เหตุผลการแก้ไข', String? initial}) async {
  final ctrl = TextEditingController(text: initial);
  final result = await showDialog<String>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text(title),
      content: TextField(
        controller: ctrl,
        autofocus: true,
        decoration: const InputDecoration(hintText: 'เช่น อ่านเลขผิด, กรอกสลับหัวจ่าย'),
        maxLength: 200,
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c), child: const Text('ยกเลิก')),
        FilledButton(onPressed: () => Navigator.pop(c, ctrl.text.trim()), child: const Text('บันทึก')),
      ],
    ),
  );
  ctrl.dispose();
  if (result == null || result.isEmpty) return null;
  return result;
}

/// ช่องกรอกตัวเลขทศนิยม (จำกัดจำนวนตำแหน่ง)
class DecimalField extends StatelessWidget {
  const DecimalField({
    super.key,
    required this.controller,
    required this.label,
    this.decimals = 3,
    this.suffix,
    this.onChanged,
    this.autofocus = false,
    this.big = false,
    this.helper,
    this.enabled = true,
    this.errorText,
  });

  final TextEditingController controller;
  final String label;
  final int decimals;
  final String? suffix;
  final ValueChanged<String>? onChanged;
  final bool autofocus;
  final bool big;
  final String? helper;
  final bool enabled;
  final String? errorText;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      enabled: enabled,
      autofocus: autofocus,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      inputFormatters: [
        FilteringTextInputFormatter.allow(RegExp(decimals == 0 ? r'[0-9]' : r'[0-9.]')),
        TextInputFormatter.withFunction((oldV, newV) {
          final re = RegExp(decimals == 0 ? r'^\d{0,12}$' : '^\\d{0,12}(\\.\\d{0,$decimals})?\$');
          return re.hasMatch(newV.text) ? newV : oldV;
        }),
      ],
      style: big ? const TextStyle(fontSize: 26, fontWeight: FontWeight.w600, fontFeatures: [FontFeature.tabularFigures()]) : null,
      decoration: InputDecoration(labelText: label, suffixText: suffix, helperText: helper, errorText: errorText),
      onChanged: onChanged,
    );
  }
}

/// รูปที่เก็บบนเซิร์ฟเวอร์ (ต้องแนบ token) หรือรูปที่ยังรอส่ง
class PhotoView extends ConsumerWidget {
  const PhotoView({super.key, required this.photoId, this.size = 56});
  final String photoId;
  final double size;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return FutureBuilder<Uint8List?>(
      future: _load(ref),
      builder: (context, snap) {
        final bytes = snap.data;
        final img = bytes == null
            ? Container(
                width: size,
                height: size,
                color: Colors.black12,
                child: Icon(snap.connectionState == ConnectionState.done ? Icons.photo_outlined : Icons.hourglass_empty, size: size / 2.5),
              )
            : Image.memory(bytes, width: size, height: size, fit: BoxFit.cover);
        return InkWell(
          onTap: bytes == null
              ? null
              : () => showDialog<void>(
                    context: context,
                    builder: (c) => Dialog(child: InteractiveViewer(child: Image.memory(bytes))),
                  ),
          child: ClipRRect(borderRadius: BorderRadius.circular(8), child: img),
        );
      },
    );
  }

  Future<Uint8List?> _load(WidgetRef ref) async {
    final db = ref.read(localDbProvider);
    final local = (await db.allOps()).where((o) => o.kind == 'photo' && o.opId == photoId).firstOrNull;
    if (local?.bytes != null) return local!.bytes;
    try {
      return await ref.read(apiProvider).getBytes('/photos/$photoId');
    } catch (_) {
      return null;
    }
  }
}

class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key, this.trailing});
  final String text;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(4, 16, 4, 8),
        child: Row(
          children: [
            Expanded(child: Text(text, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600))),
            ?trailing,
          ],
        ),
      );
}

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/api.dart';
import '../../core/session.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _tenant = TextEditingController();
  final _username = TextEditingController();
  final _password = TextEditingController();
  final _server = TextEditingController(text: defaultApiUrl);
  bool _busy = false;
  bool _showServer = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    ref.read(sessionProvider.notifier).lastLogin().then((last) {
      if (last == null || !mounted) return;
      setState(() {
        _tenant.text = last['tenant'] as String? ?? '';
        _username.text = last['username'] as String? ?? '';
        _server.text = last['baseUrl'] as String? ?? defaultApiUrl;
      });
    });
  }

  @override
  void dispose() {
    for (final c in [_tenant, _username, _password, _server]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    if (_tenant.text.trim().isEmpty || _username.text.trim().isEmpty || _password.text.isEmpty) {
      setState(() => _error = 'กรุณากรอกรหัสปั๊ม ชื่อผู้ใช้ และรหัสผ่าน');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(sessionProvider.notifier).login(
            baseUrl: _server.text.trim().replaceAll(RegExp(r'/+$'), ''),
            tenant: _tenant.text,
            username: _username.text,
            password: _password.text,
          );
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: AutofillGroup(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Icon(Icons.local_gas_station_rounded, size: 72, color: theme.colorScheme.primary),
                    const SizedBox(height: 12),
                    Text('ระบบปั๊มน้ำมัน', textAlign: TextAlign.center, style: theme.textTheme.headlineMedium),
                    const SizedBox(height: 4),
                    Text('ปิดกะ · สต็อกถัง · Dashboard', textAlign: TextAlign.center, style: theme.textTheme.bodyMedium),
                    const SizedBox(height: 32),
                    TextField(
                      controller: _tenant,
                      decoration: const InputDecoration(labelText: 'รหัสปั๊ม', prefixIcon: Icon(Icons.store_outlined)),
                      textInputAction: TextInputAction.next,
                      autocorrect: false,
                    ),
                    const SizedBox(height: 16),
                    TextField(
                      controller: _username,
                      decoration: const InputDecoration(labelText: 'ชื่อผู้ใช้', prefixIcon: Icon(Icons.person_outline)),
                      textInputAction: TextInputAction.next,
                      autofillHints: const [AutofillHints.username],
                      autocorrect: false,
                    ),
                    const SizedBox(height: 16),
                    TextField(
                      controller: _password,
                      decoration: const InputDecoration(labelText: 'รหัสผ่าน', prefixIcon: Icon(Icons.lock_outline)),
                      obscureText: true,
                      autofillHints: const [AutofillHints.password],
                      onSubmitted: (_) => _submit(),
                    ),
                    if (_showServer) ...[
                      const SizedBox(height: 16),
                      TextField(
                        controller: _server,
                        decoration: const InputDecoration(labelText: 'ที่อยู่เซิร์ฟเวอร์', prefixIcon: Icon(Icons.dns_outlined)),
                        keyboardType: TextInputType.url,
                        autocorrect: false,
                      ),
                    ],
                    if (_error != null) ...[
                      const SizedBox(height: 16),
                      Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
                    ],
                    const SizedBox(height: 24),
                    FilledButton(
                      onPressed: _busy ? null : _submit,
                      child: _busy
                          ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5))
                          : const Text('เข้าสู่ระบบ'),
                    ),
                    TextButton(
                      onPressed: () => setState(() => _showServer = !_showServer),
                      child: Text(_showServer ? 'ซ่อนการตั้งค่าเซิร์ฟเวอร์' : 'ตั้งค่าเซิร์ฟเวอร์'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

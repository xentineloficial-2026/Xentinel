import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../components/xentinel_brand.dart';
import '../components/xentinel_motion.dart';
import '../core/api_config.dart';
import '../core/session.dart';
import '../core/theme.dart';

import '../providers/auth_provider.dart';
import '../services/server_settings.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _docController = TextEditingController();
  final _passController = TextEditingController();
  bool _obscure = true;

  @override
  void dispose() {
    _docController.dispose();
    _passController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    final error = await ref
        .read(authControllerProvider.notifier)
        .login(_docController.text, _passController.text);
    if (error != null && mounted) {
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(error)));
    }
  }

  Future<void> _editServer() async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => const _ServerDialog(),
    );
    if (saved == true && mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final loading = ref.watch(authControllerProvider).isLoading;
    final server = Uri.tryParse(ApiConfig.baseUrl)?.authority ?? '';
    final sessionMessage = ref.watch(sessionProvider).message;

    return Scaffold(
      body: Stack(
        children: [
          const Positioned.fill(child: FacetBackdrop()),
          SafeArea(
            child: Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(
                  horizontal: 20,
                  vertical: 24,
                ),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 440),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Center(child: Shield3D(size: 104)),
                      const SizedBox(height: 14),
                      const Text(
                        'Xentinel',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w600,
                          letterSpacing: -0.4,
                        ),
                      ),
                      const SizedBox(height: 28),
                      Entrance(
                        child: GlassPanel(
                          child: _form(loading, sessionMessage, server),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _form(bool loading, String? sessionMessage, String server) => Column(
    mainAxisSize: MainAxisSize.min,
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Text(
        'Nos alegra tenerte aquí',
        style: Theme.of(context).textTheme.headlineSmall,
      ),
      const SizedBox(height: 6),
      const Text(
        'Ingresa para llevar tu carnet y las alertas de tu sede contigo.',
        style: TextStyle(color: XentinelTheme.steel),
      ),
      const SizedBox(height: 22),
      if (sessionMessage != null)
        Padding(
          padding: const EdgeInsets.only(bottom: 16),
          child: Text(
            sessionMessage,
            style: const TextStyle(color: XentinelTheme.warning),
          ),
        ),
      TextField(
        controller: _docController,
        enabled: !loading,
        autofillHints: const [AutofillHints.username],
        keyboardType: TextInputType.number,
        textInputAction: TextInputAction.next,
        decoration: const InputDecoration(
          labelText: 'Número de documento',
          prefixIcon: Icon(Icons.badge_outlined),
        ),
      ),
      const SizedBox(height: 14),
      TextField(
        controller: _passController,
        enabled: !loading,
        autofillHints: const [AutofillHints.password],
        obscureText: _obscure,
        textInputAction: TextInputAction.done,
        onSubmitted: (_) => _submit(),
        decoration: InputDecoration(
          labelText: 'Contraseña',
          prefixIcon: const Icon(Icons.lock_outline),
          suffixIcon: IconButton(
            tooltip: _obscure ? 'Mostrar contraseña' : 'Ocultar contraseña',
            icon: Icon(_obscure ? Icons.visibility_off : Icons.visibility),
            onPressed: () => setState(() => _obscure = !_obscure),
          ),
        ),
      ),
      const SizedBox(height: 20),
      FilledButton(
        onPressed: loading ? null : _submit,
        child: loading
            ? const SizedBox(
                height: 22,
                width: 22,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: XentinelTheme.steel,
                ),
              )
            : const Text('Ingresar'),
      ),
      const SizedBox(height: 8),
      TextButton(
        onPressed: loading ? null : () => context.push('/forgot-password'),
        child: const Text('¿Olvidaste tu contraseña?'),
      ),
      if (!ApiConfig.hasFixedServer)
        TextButton.icon(
          onPressed: loading ? null : _editServer,
          icon: const Icon(
            Icons.dns_outlined,
            size: 18,
            color: XentinelTheme.steel,
          ),
          label: Text(
            server.isEmpty ? 'Configurar servidor' : 'Servidor: $server',
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: XentinelTheme.steel),
          ),
        ),
    ],
  );
}

/// Cambia el servidor sin recompilar; solo guarda una dirección que respondió.
class _ServerDialog extends StatefulWidget {
  const _ServerDialog();

  @override
  State<_ServerDialog> createState() => _ServerDialogState();
}

class _ServerDialogState extends State<_ServerDialog> {
  late final _controller = TextEditingController(
    text: ApiConfig.baseUrl.replaceFirst(RegExp(r'/api/v1/?$'), ''),
  );
  bool _checking = false;
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _testAndSave() async {
    final url = ApiConfig.normalizeServer(_controller.text);
    if (url == null) {
      setState(() => _error = 'Escribe una dirección como 192.168.1.40:8000');
      return;
    }
    setState(() {
      _checking = true;
      _error = null;
    });
    final error = await ServerSettings.check(url);
    if (!mounted) return;
    if (error != null) {
      setState(() {
        _checking = false;
        _error = error;
      });
      return;
    }
    await ServerSettings.save(url);
    if (mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Servidor de Xentinel'),
      content: TextField(
        controller: _controller,
        enabled: !_checking,
        autocorrect: false,
        keyboardType: TextInputType.url,
        decoration: InputDecoration(
          labelText: 'Dirección',
          hintText: '192.168.1.40:8000 o https://mi-tunel',
          errorText: _error,
          errorMaxLines: 4,
        ),
      ),
      actions: [
        TextButton(
          onPressed: _checking ? null : () => Navigator.of(context).pop(false),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          onPressed: _checking ? null : _testAndSave,
          child: Text(_checking ? 'Probando…' : 'Probar y guardar'),
        ),
      ],
    );
  }
}

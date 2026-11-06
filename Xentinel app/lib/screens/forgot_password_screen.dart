import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../components/xentinel_brand.dart';
import '../core/errors.dart';
import '../core/theme.dart';
import '../repositories/auth_repository.dart';

class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});
  @override
  ConsumerState<ForgotPasswordScreen> createState() =>
      _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _email = TextEditingController();
  final _form = GlobalKey<FormState>();
  bool _loading = false;
  bool _sent = false;
  String? _error;
  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_loading || !_form.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await ref.read(authRepositoryProvider).forgotPassword(_email.text);
      if (mounted) setState(() => _sent = true);
    } catch (e) {
      if (mounted) setState(() => _error = describeError(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Recuperar contraseña')),
    body: SafeArea(
      child: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(28),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 440),
            child: Form(
              key: _form,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Center(child: XentinelLogo(size: 60)),
                  const SizedBox(height: 24),
                  Text(
                    _sent ? 'Revisa tu correo' : 'Recupera tu acceso',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.headlineLarge,
                  ),
                  const SizedBox(height: 16),
                  Text(
                    _sent
                        ? 'Si el correo corresponde a una cuenta activa, recibirás un enlace para restablecer tu contraseña. Revisa también la carpeta de correo no deseado.'
                        : 'No te preocupes, te ayudamos a volver. Escribe el correo registrado en Xentinel para recibir las instrucciones.',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: XentinelTheme.steel,
                      height: 1.5,
                    ),
                  ),
                  const SizedBox(height: 28),
                  if (!_sent) ...[
                    TextFormField(
                      controller: _email,
                      enabled: !_loading,
                      keyboardType: TextInputType.emailAddress,
                      autofillHints: const [AutofillHints.email],
                      autocorrect: false,
                      decoration: const InputDecoration(
                        labelText: 'Correo electrónico',
                        prefixIcon: Icon(Icons.mail_outline),
                      ),
                      validator: (value) =>
                          value != null &&
                              RegExp(
                                r'^[^\s@]+@[^\s@]+\.[^\s@]+$',
                              ).hasMatch(value.trim()) &&
                              value.trim().length <= 254
                          ? null
                          : 'Escribe un correo electrónico válido.',
                      onFieldSubmitted: (_) => _submit(),
                    ),
                    const SizedBox(height: 20),
                    if (_error != null) ...[
                      Text(
                        _error!,
                        style: const TextStyle(color: XentinelTheme.danger),
                      ),
                      const SizedBox(height: 16),
                    ],
                    FilledButton(
                      onPressed: _loading ? null : _submit,
                      child: Text(_loading ? 'Enviando…' : 'Enviar enlace'),
                    ),
                  ] else
                    FilledButton(
                      onPressed: () => context.go('/login'),
                      child: const Text('Volver al inicio de sesión'),
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

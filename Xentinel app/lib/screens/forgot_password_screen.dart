import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../components/xentinel_brand.dart';
import '../core/api_config.dart';
import '../core/errors.dart';
import '../core/theme.dart';
import '../repositories/auth_repository.dart';

enum _Step { email, code, password, done }

/// Recuperación en tres pasos: correo, código de 6 dígitos y nueva contraseña.
class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});
  @override
  ConsumerState<ForgotPasswordScreen> createState() =>
      _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _email = TextEditingController();
  final _code = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  final _form = GlobalKey<FormState>();
  _Step _step = _Step.email;
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    for (final controller in [_email, _code, _password, _confirm]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _run(Future<void> Function() task) async {
    if (_loading) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await task();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = describeError(e);
        // El código venció mientras escribía la contraseña: se pide de nuevo.
        if (e.code == 'INVALID_RESET_CODE' && _step == _Step.password) {
          _code.clear();
          _step = _Step.code;
        }
      });
    } catch (e) {
      if (mounted) setState(() => _error = describeError(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _requestCode() async {
    // Al reenviar desde el paso del código el correo ya fue validado.
    if (_step == _Step.email && !(_form.currentState?.validate() ?? false)) {
      return;
    }
    await _run(() async {
      await ref.read(authRepositoryProvider).forgotPassword(_email.text);
      if (!mounted) return;
      _code.clear();
      setState(() => _step = _Step.code);
    });
  }

  Future<void> _verifyCode() async {
    if (!_form.currentState!.validate()) return;
    await _run(() async {
      await ref
          .read(authRepositoryProvider)
          .verifyResetCode(_email.text, _code.text);
      if (mounted) setState(() => _step = _Step.password);
    });
  }

  Future<void> _savePassword() async {
    if (!_form.currentState!.validate()) return;
    await _run(() async {
      await ref
          .read(authRepositoryProvider)
          .resetPassword(_email.text, _code.text, _password.text);
      if (!mounted) return;
      _code.clear();
      _password.clear();
      _confirm.clear();
      setState(() => _step = _Step.done);
    });
  }

  String get _title => switch (_step) {
    _Step.email => 'Recupera tu acceso',
    _Step.code => 'Escribe tu código',
    _Step.password => 'Crea tu nueva contraseña',
    _Step.done => 'Contraseña actualizada',
  };

  String get _subtitle => switch (_step) {
    _Step.email =>
      'Escribe el correo registrado en Xentinel y te enviaremos un código de 6 dígitos.',
    _Step.code =>
      'Si el correo corresponde a una cuenta activa, te enviamos un código. Vence a los 15 minutos; tras 5 intentos fallidos debes pedir otro. Revisa también la carpeta de spam.',
    _Step.password =>
      'Código verificado. Usa una contraseña que no utilices en otro servicio.',
    _Step.done => 'Ya puedes iniciar sesión con tu nueva contraseña.',
  };

  List<Widget> _fields() => switch (_step) {
    _Step.email => [
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
                RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(value.trim()) &&
                value.trim().length <= 254
            ? null
            : 'Escribe un correo electrónico válido.',
        onFieldSubmitted: (_) => _requestCode(),
      ),
    ],
    _Step.code => [
      TextFormField(
        controller: _code,
        enabled: !_loading,
        keyboardType: TextInputType.number,
        autofillHints: const [AutofillHints.oneTimeCode],
        textAlign: TextAlign.center,
        style: const TextStyle(fontSize: 28, letterSpacing: 10),
        inputFormatters: [
          FilteringTextInputFormatter.digitsOnly,
          LengthLimitingTextInputFormatter(6),
        ],
        decoration: const InputDecoration(labelText: 'Código de 6 dígitos'),
        validator: (value) => RegExp(r'^[0-9]{6}$').hasMatch(value ?? '')
            ? null
            : 'Escribe los 6 dígitos del código.',
        onFieldSubmitted: (_) => _verifyCode(),
      ),
    ],
    _Step.password => [
      TextFormField(
        controller: _password,
        enabled: !_loading,
        obscureText: true,
        autofillHints: const [AutofillHints.newPassword],
        decoration: const InputDecoration(
          labelText: 'Nueva contraseña',
          prefixIcon: Icon(Icons.lock_outline),
          helperText: 'Entre 6 caracteres y 72 bytes.',
        ),
        validator: (value) {
          final text = value ?? '';
          if (text.length < 6) return 'Usa al menos 6 caracteres.';
          if (utf8.encode(text).length > 72) {
            return 'La contraseña supera los 72 bytes.';
          }
          return null;
        },
      ),
      const SizedBox(height: 16),
      TextFormField(
        controller: _confirm,
        enabled: !_loading,
        obscureText: true,
        decoration: const InputDecoration(
          labelText: 'Confirmar contraseña',
          prefixIcon: Icon(Icons.lock_outline),
        ),
        validator: (value) =>
            value == _password.text ? null : 'Las contraseñas no coinciden.',
        onFieldSubmitted: (_) => _savePassword(),
      ),
    ],
    _Step.done => const [],
  };

  Widget _primaryButton() => switch (_step) {
    _Step.email => FilledButton(
      onPressed: _loading ? null : _requestCode,
      child: Text(_loading ? 'Enviando…' : 'Enviar código'),
    ),
    _Step.code => FilledButton(
      onPressed: _loading ? null : _verifyCode,
      child: Text(_loading ? 'Verificando…' : 'Verificar código'),
    ),
    _Step.password => FilledButton(
      onPressed: _loading ? null : _savePassword,
      child: Text(_loading ? 'Guardando…' : 'Guardar contraseña'),
    ),
    _Step.done => FilledButton(
      onPressed: () => context.go('/login'),
      child: const Text('Iniciar sesión'),
    ),
  };

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
                    _title,
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.headlineLarge,
                  ),
                  const SizedBox(height: 16),
                  Text(
                    _subtitle,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: XentinelTheme.steel,
                      height: 1.5,
                    ),
                  ),
                  const SizedBox(height: 28),
                  ..._fields(),
                  const SizedBox(height: 20),
                  if (_error != null) ...[
                    Text(
                      _error!,
                      style: const TextStyle(color: XentinelTheme.danger),
                    ),
                    const SizedBox(height: 16),
                  ],
                  _primaryButton(),
                  if (_step == _Step.code)
                    TextButton(
                      onPressed: _loading ? null : _requestCode,
                      child: const Text('Enviar un código nuevo'),
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

import 'package:flutter/foundation.dart';
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

class _LoginScreenState extends ConsumerState<LoginScreen>
    with SingleTickerProviderStateMixin {
  /// La apertura se ve una vez por arranque de la app, no al volver tras cerrar sesión.
  static bool _openingShown = false;

  /// Alto de la X al arrancar: el mismo del arranque de Android 12+ (icono adaptable).
  static const _splashMarkWidth = 117.0;
  static const _headerMarkWidth = 58.0;

  final _docController = TextEditingController();
  final _passController = TextEditingController();
  final _markSlot = GlobalKey();
  late final AnimationController _opening = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1600),
  );

  /// Distancia del centro de la pantalla al lugar final de la X.
  Offset _markTravel = Offset.zero;

  /// Hasta medir su destino y tener la imagen lista, la X no se dibuja: nunca salta.
  bool _measuring = false;
  bool _obscure = true;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_opening.status != AnimationStatus.dismissed) return;
    if (_openingShown || !motionEnabled(context)) {
      _opening.value = 1;
      return;
    }
    _openingShown = true;
    _measuring = true;
    // Se mide el lugar de la X en el primer cuadro y luego se anima hacia él. La
    // imagen se decodifica antes de mostrarla: así la X del arranque nativo nunca
    // desaparece, ni por un instante, al pasar a Flutter.
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) return;
      final ready = precacheImage(
        const AssetImage(XentinelLogo.asset),
        context,
      );
      final box = _markSlot.currentContext?.findRenderObject() as RenderBox?;
      final screen = MediaQuery.sizeOf(context);
      final travel = box != null && box.hasSize
          ? Offset(screen.width / 2, screen.height / 2) -
                box.localToGlobal(box.size.center(Offset.zero))
          : Offset.zero;
      await ready;
      if (!mounted) return;
      setState(() {
        _markTravel = travel;
        _measuring = false;
      });
      _opening.forward();
    });
  }

  @override
  void dispose() {
    _opening.dispose();
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
      body: AnimatedBuilder(
        animation: _opening,
        builder: (context, _) {
          final t = _opening.value;
          // Un solo momento coreografiado, en tres tiempos que se solapan:
          // 1. un haz de luz recorre la X, quieta en el centro como el arranque nativo;
          // 2. la X sube a su lugar y se achica mientras aparecen las facetas;
          // 3. el nombre y el formulario entran desde abajo.
          final sheen = const Interval(
            0.04,
            0.42,
            curve: Curves.easeInOut,
          ).transform(t);
          final settle = const Interval(
            0.34,
            0.72,
            curve: Curves.easeInOutCubic,
          ).transform(t);
          final content = const Interval(
            0.58,
            1,
            curve: Curves.easeOutCubic,
          ).transform(t);
          final markWidth =
              _splashMarkWidth + (_headerMarkWidth - _splashMarkWidth) * settle;
          return Stack(
            children: [
              Positioned.fill(
                child: Opacity(opacity: settle, child: const FacetBackdrop()),
              ),
              SafeArea(
                child: Center(
                  child: SingleChildScrollView(
                    // Durante la apertura la X viaja fuera del bloque: sin recorte.
                    clipBehavior: t < 1 ? Clip.none : Clip.hardEdge,
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
                          Center(
                            child: SizedBox(
                              key: _markSlot,
                              width: _headerMarkWidth,
                              height:
                                  _headerMarkWidth * XentinelLogo.aspectRatio,
                              child: OverflowBox(
                                maxWidth: _splashMarkWidth,
                                maxHeight:
                                    _splashMarkWidth * XentinelLogo.aspectRatio,
                                child: Opacity(
                                  opacity: _measuring ? 0 : 1,
                                  child: Transform.translate(
                                    offset: _markTravel * (1 - settle),
                                    child: SheenMark(
                                      size: markWidth,
                                      progress: sheen,
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(height: 14),
                          _Rising(
                            value: content,
                            child: const Text(
                              'Xentinel',
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                fontSize: 22,
                                fontWeight: FontWeight.w600,
                                letterSpacing: -0.4,
                              ),
                            ),
                          ),
                          const SizedBox(height: 28),
                          _Rising(
                            value: const Interval(0.15, 1).transform(content),
                            distance: 28,
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
          );
        },
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
      if (ApiConfig.allowServerOverride)
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

/// Bloque que sube y aparece según [value] (0 a 1), dentro de la apertura del login.
class _Rising extends StatelessWidget {
  const _Rising({required this.value, required this.child, this.distance = 16});
  final double value;
  final double distance;
  final Widget child;

  @override
  Widget build(BuildContext context) => Opacity(
    opacity: value,
    child: Transform.translate(
      offset: Offset(0, (1 - value) * distance),
      child: child,
    ),
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
      setState(
        () => _error = kReleaseMode
            ? 'Escribe una dirección como https://xentinel.midominio.co'
            : 'Escribe una dirección como 192.168.1.40:8000',
      );
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
          hintText: kReleaseMode
              ? 'https://xentinel.midominio.co'
              : '192.168.1.40:8000 o https://mi-servidor',
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

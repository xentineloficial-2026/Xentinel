import 'package:flutter/material.dart';

/// Sistema Xentinel. Replica los tokens de la web (public/tema.css): si cambias
/// uno, cambia ambos. La interfaz es sobria; el color saturado queda reservado
/// para las emergencias y para el resultado del escáner.
class XentinelTheme {
  XentinelTheme._();

  // Base
  static const Color ink = Color(0xFF06141B);
  static const Color surface = Color(0xFF0D1D27);
  static const Color raised = Color(0xFF162936);
  static const Color border = Color(0xFF253745);
  static const Color slate = Color(0xFF4A5C6A);
  static const Color steel = Color(0xFF9BA8AB);
  static const Color mist = Color(0xFFCCD0CF);
  static const Color text = Color(0xFFEDF0EF);
  static const Color glass = Color(0x9E11212D);
  static const Color glassBorder = Color(0x21CCD0CF);

  // Señales discretas
  static const Color success = Color(0xFF8FC3A8);
  static const Color warning = Color(0xFFD9B878);
  static const Color danger = Color(0xFFE39A8C);

  // Solo emergencias y resultado de acceso
  static const Color emergency = Color(0xFFC4231A);
  static const Color emergencyDeep = Color(0xFF8E150F);
  static const Color alarm = Color(0xFFE8A33D);
  static const Color granted = Color(0xFF1B7F53);

  // Radios compartidos con la web
  static const double radiusS = 8;
  static const double radiusM = 12;
  static const double radiusL = 16;

  static const String fontFamily = 'Archivo';
  static const String monoFamily = 'IBMPlexMono';

  /// Horas, documentos y otros datos que deben alinearse.
  static const TextStyle mono = TextStyle(
    fontFamily: monoFamily,
    color: steel,
    fontSize: 13,
  );

  static ThemeData dark() {
    const scheme = ColorScheme.dark(
      primary: mist,
      onPrimary: ink,
      secondary: steel,
      onSecondary: ink,
      surface: surface,
      onSurface: text,
      onSurfaceVariant: steel,
      outline: border,
      outlineVariant: border,
      error: danger,
      onError: ink,
    );
    final buttonShape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(radiusM),
    );
    const buttonText = TextStyle(
      fontFamily: fontFamily,
      fontSize: 16,
      fontWeight: FontWeight.w600,
    );
    OutlineInputBorder inputBorder(Color color) => OutlineInputBorder(
      borderRadius: BorderRadius.circular(radiusS),
      borderSide: BorderSide(color: color),
    );

    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: scheme,
      fontFamily: fontFamily,
      scaffoldBackgroundColor: ink,
      splashFactory: InkSparkle.splashFactory,
      textTheme: const TextTheme(
        headlineLarge: TextStyle(
          fontSize: 32,
          height: 1.1,
          fontWeight: FontWeight.w600,
          letterSpacing: -0.7,
          color: text,
        ),
        headlineSmall: TextStyle(
          fontSize: 24,
          height: 1.15,
          fontWeight: FontWeight.w600,
          letterSpacing: -0.4,
          color: text,
        ),
        bodyLarge: TextStyle(fontSize: 16, height: 1.45, color: text),
        bodyMedium: TextStyle(fontSize: 15, height: 1.45, color: text),
        bodySmall: TextStyle(fontSize: 13, height: 1.4, color: steel),
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: ink,
        foregroundColor: text,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          fontFamily: fontFamily,
          fontSize: 18,
          fontWeight: FontWeight.w600,
          color: text,
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: mist,
          foregroundColor: ink,
          disabledBackgroundColor: raised,
          disabledForegroundColor: steel,
          minimumSize: const Size.fromHeight(52),
          shape: buttonShape,
          textStyle: buttonText,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: text,
          minimumSize: const Size.fromHeight(52),
          side: const BorderSide(color: border),
          shape: buttonShape,
          textStyle: buttonText,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: text,
          textStyle: const TextStyle(
            fontFamily: fontFamily,
            fontSize: 15,
            fontWeight: FontWeight.w500,
          ),
        ),
      ),
      segmentedButtonTheme: SegmentedButtonThemeData(
        style: ButtonStyle(
          minimumSize: const WidgetStatePropertyAll(Size(0, 48)),
          side: const WidgetStatePropertyAll(BorderSide.none),
          shape: WidgetStatePropertyAll(
            RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(radiusS),
            ),
          ),
          backgroundColor: WidgetStateProperty.resolveWith(
            (states) => states.contains(WidgetState.selected)
                ? mist
                : Colors.transparent,
          ),
          foregroundColor: WidgetStateProperty.resolveWith(
            (states) => states.contains(WidgetState.selected) ? ink : text,
          ),
          textStyle: const WidgetStatePropertyAll(
            TextStyle(
              fontFamily: fontFamily,
              fontSize: 14,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: ink,
        labelStyle: const TextStyle(color: steel),
        floatingLabelStyle: const TextStyle(color: mist),
        prefixIconColor: steel,
        suffixIconColor: steel,
        errorStyle: const TextStyle(color: danger, height: 1.3),
        border: inputBorder(border),
        enabledBorder: inputBorder(border),
        disabledBorder: inputBorder(raised),
        focusedBorder: inputBorder(mist),
        errorBorder: inputBorder(danger),
        focusedErrorBorder: inputBorder(danger),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: raised,
        contentTextStyle: const TextStyle(
          fontFamily: fontFamily,
          color: text,
          fontSize: 15,
        ),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusM),
        ),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusL),
        ),
      ),
      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: mist,
        linearTrackColor: border,
      ),
      dividerTheme: const DividerThemeData(color: border, thickness: 1),
    );
  }
}

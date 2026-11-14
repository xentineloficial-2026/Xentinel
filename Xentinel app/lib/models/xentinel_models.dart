import 'package:flutter/painting.dart' show Color;

/// Roles normalizados de la API de Xentinel.
///
/// Equivalencia con la tabla `rol`: Aprendiz, Instructor, Administrador,
/// Celador (-> GUARDIA), Funcionarios (-> FUNCIONARIO) y visitantes.
enum UserRole {
  administrador('ADMINISTRADOR'),
  guardia('GUARDIA'),
  aprendiz('APRENDIZ'),
  instructor('INSTRUCTOR'),
  funcionario('FUNCIONARIO'),
  visitante('VISITANTE');

  const UserRole(this.dbValue);
  final String dbValue;

  String get label => switch (this) {
    UserRole.administrador => 'Administrador',
    UserRole.guardia => 'Control de acceso',
    UserRole.aprendiz => 'Aprendiz',
    UserRole.instructor => 'Instructor',
    UserRole.funcionario => 'Funcionario',
    UserRole.visitante => 'Visitante',
  };
}

/// Estado de acceso de un usuario.
enum AccessStatus {
  permitido('PERMITIDO'),
  denegado('DENEGADO'),
  pendiente('PENDIENTE'),
  visitante('VISITANTE');

  const AccessStatus(this.dbValue);
  final String dbValue;
}

/// Usuario de Xentinel (sin foto de perfil).
///
/// Se construye con `usuario` en la respuesta de auth/login.
/// La posición dentro/fuera la valida el servidor al registrar cada movimiento.
class UserEntity {
  const UserEntity({
    required this.id,
    required this.name,
    required this.documentId,
    required this.role,
    required this.status,
    this.denialReason,
  });

  final String id;
  final String name;
  final String documentId;
  final UserRole role;
  final AccessStatus status;
  final String? denialReason;

  factory UserEntity.fromApi(Map<String, dynamic> map) {
    final id = map['id_usuarios'];
    if (id is! int ||
        id <= 0 ||
        map['nombres_completos'] is! String ||
        map['nombre_rol'] is! String) {
      throw const FormatException('Respuesta de usuario inválida');
    }
    final role = switch ((map['nombre_rol'] as String).toLowerCase()) {
      'administrador' || 'admin' => UserRole.administrador,
      'celador' || 'guardia' => UserRole.guardia,
      'instructor' || 'profesor' => UserRole.instructor,
      'aprendiz' => UserRole.aprendiz,
      'funcionarios' || 'funcionario' => UserRole.funcionario,
      _ => UserRole.visitante,
    };
    final allowed = map['estado']?.toString().toLowerCase() == 'activo';
    return UserEntity(
      id: '$id',
      name: map['nombres_completos'] as String,
      documentId: '${map['numero_documento'] ?? ''}',
      role: role,
      status: !allowed
          ? AccessStatus.denegado
          : role == UserRole.visitante
          ? AccessStatus.visitante
          : AccessStatus.permitido,
    );
  }
}

/// Resultado de un escaneo: el "semáforo" de Xentinel.
sealed class AccessScanResult {
  const AccessScanResult({this.user});

  /// Usuario escaneado (si se pudo resolver).
  final UserEntity? user;

  Color get color;
  String get message;
  AccessStatus get status;
}

/// Datos básicos de quien acaba de ser autorizado.
class ScannedPerson {
  const ScannedPerson({
    required this.name,
    required this.document,
    this.ficha,
    this.aula,
  });
  final String name;
  final String document;
  final String? ficha;
  final String? aula;

  /// Un servidor sin estos datos no impide autorizar: solo no se muestran.
  static ScannedPerson? fromApi(Object? data) {
    if (data is! Map || data['nombres_completos'] is! String) return null;
    return ScannedPerson(
      name: data['nombres_completos'] as String,
      document:
          '${data['tipo_documento'] ?? ''} ${data['numero_documento'] ?? ''}'
              .trim(),
      ficha: data['numero_ficha']?.toString(),
      aula: data['ambiente']?.toString(),
    );
  }
}

/// PERMITIDO (verde).
final class Granted extends AccessScanResult {
  const Granted({super.user, this.person});
  final ScannedPerson? person;

  @override
  Color get color => const Color(0xFF1B7F53);
  @override
  String get message => 'Acceso Permitido';
  @override
  AccessStatus get status => AccessStatus.permitido;
}

/// PENDIENTE (amarillo): QR ya usado o usuario ya dentro de la sede.
final class Alert extends AccessScanResult {
  const Alert({super.user, this.reason});

  /// Qué debe hacer el personal de control para registrar el movimiento.
  final String? reason;

  @override
  Color get color => const Color(0xFFE8A33D);
  @override
  String get message => 'Movimiento fuera de orden';
  @override
  AccessStatus get status => AccessStatus.pendiente;
}

/// NO ENCONTRADO (amarillo): el QR es legible, pero el usuario no está registrado.
final class NotRegistered extends AccessScanResult {
  const NotRegistered();

  @override
  Color get color => const Color(0xFFE8A33D);
  @override
  String get message => 'Usuario no registrado';
  @override
  AccessStatus get status => AccessStatus.pendiente;
}

/// DENEGADO (rojo).
final class Denied extends AccessScanResult {
  const Denied({super.user, this.reason, this.person});

  /// Motivo de rechazo que se muestra al personal de control de acceso.
  final String? reason;

  /// Quién intentó entrar, cuando el servidor pudo identificarlo.
  final ScannedPerson? person;

  @override
  Color get color => const Color(0xFFC4231A);
  @override
  String get message => 'Acceso denegado';
  @override
  AccessStatus get status => AccessStatus.denegado;
}

/// VISITANTE (gris).
final class VisitorAccess extends AccessScanResult {
  const VisitorAccess({super.user});

  @override
  Color get color => const Color(0xFF4A5C6A);
  @override
  String get message => 'Acceso de Visitante';
  @override
  AccessStatus get status => AccessStatus.visitante;
}

/// A timeout may happen after the server commits: never report it as a denial.
final class Unconfirmed extends AccessScanResult {
  const Unconfirmed({required this.reason});
  final String reason;
  @override
  Color get color => const Color(0xFFE8A33D);
  @override
  String get message => 'No se pudo confirmar el acceso';
  @override
  AccessStatus get status => AccessStatus.pendiente;
}

/// Sin conexión con el servidor: el movimiento quedó guardado en el teléfono y se
/// enviará automáticamente al recuperar la red (azul institucional, no verde: el
/// servidor todavía no lo confirmó).
final class QueuedOffline extends AccessScanResult {
  const QueuedOffline({required this.userId, this.repeated = false});

  /// Identificador del carnet leído.
  final int userId;

  /// El mismo paso ya estaba en la cola: no se guardó dos veces.
  final bool repeated;

  @override
  Color get color => const Color(0xFF18458D);
  @override
  String get message => 'Registrado sin conexión';
  @override
  AccessStatus get status => AccessStatus.pendiente;
}

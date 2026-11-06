/** Roles y módulos canónicos. Los nombres de la API se normalizan sin modificar sus permisos. */
export /* ALIAS_ROLES: valor de trabajo utilizado en esta operación. */
const ALIAS_ROLES = {
  admin: ['admin', 'administrador', '3'],
  instructor: ['instructor', 'profesor', '2'],
  celador: ['celador', '4'],
  visitante: [
    'visitante',
    'aprendiz',
    'usuario nuevo',
    'usuarionuevo',
    '1',
    '5',
    '6',
  ],
};
export function rolParaUsuario(usuario) {
  if (!usuario) return null;
  /* nombre: valor de trabajo utilizado en esta operación. */
  const nombre = String(
    usuario.nombre_rol || usuario.role || usuario.id_rol || ''
  )
    .toLowerCase()
    .trim();
  return (
    Object.keys(ALIAS_ROLES).find((rol) => ALIAS_ROLES[rol].includes(nombre)) ||
    'visitante'
  );
}
/** Todo inicio de sesión termina en el resumen del rol, nunca en el formulario de contraseña. */
export function inicioParaUsuario(usuario) {
  return usuario ? `/${rolParaUsuario(usuario)}` : '/login';
}
export function destinoTrasAcceso(usuario) {
  return inicioParaUsuario(usuario);
}
/** Navegación pública: los módulos solo presentan accesos compatibles con la sesión actual. */
export /* modulosPlataforma: valor de trabajo utilizado en esta operación. */
const modulosPlataforma = [
  {
    id: 'ingresos',
    titulo: 'Ingresos y salidas',
    descripcion:
      'Registra movimientos y consulta el historial de tu institución.',
    icono: 'scan',
    roles: ['admin', 'celador'],
    destinos: {
      admin: '/admin?modulo=ingresos',
      celador: '/celador?modulo=ingresos',
    },
  },
  {
    id: 'usuarios',
    titulo: 'Personas',
    descripcion:
      'Cada persona tiene su lugar. Organiza perfiles, roles y estados.',
    icono: 'users',
    roles: ['admin'],
    destinos: {
      admin: '/admin?modulo=usuarios',
    },
  },
  {
    id: 'fichas',
    titulo: 'Fichas y comunidad',
    descripcion:
      'Conoce tus grupos y consulta la información académica en tarjetas.',
    icono: 'check',
    roles: ['admin', 'instructor', 'visitante'],
    destinos: {
      admin: '/admin?modulo=fichas',
      instructor: '/instructor?modulo=fichas',
      visitante: '/visitante?modulo=fichas',
    },
  },
  {
    id: 'horarios',
    titulo: 'Tu agenda académica',
    descripcion: 'Visualiza clases, ambientes y jornadas durante la semana.',
    icono: 'calendar',
    roles: ['admin', 'instructor', 'visitante'],
    destinos: {
      admin: '/admin?modulo=horarios',
      instructor: '/instructor?modulo=horarios',
      visitante: '/visitante?modulo=horarios',
    },
  },
  {
    id: 'alertas',
    titulo: 'Alertas y cuidado',
    descripcion: 'Consulta instrucciones, reporta tu grupo y solicita ayuda.',
    icono: 'bell',
    roles: ['admin', 'instructor', 'celador', 'visitante'],
    destinos: {
      admin: '/admin?modulo=alertas',
      instructor: '/instructor?modulo=alertas',
      celador: '/celador?modulo=alertas',
      visitante: '/visitante?modulo=alertas',
    },
  },
  {
    id: 'qr',
    titulo: 'Tu identificación QR',
    descripcion:
      'Lleva tu identificador contigo y facilita el registro de acceso.',
    icono: 'shield',
    roles: ['admin', 'instructor', 'celador', 'visitante'],
    destinos: {
      admin: '/admin?modulo=qr',
      instructor: '/instructor?modulo=qr',
      celador: '/celador?modulo=qr',
      visitante: '/visitante?modulo=qr',
    },
  },
];

export const userColumns = `u.id_usuarios,u.nombres_completos,u.tipo_documento,u.numero_documento,u.correo,
 u.telefono,u.fecha_nacimiento,u.estado,u.id_rol,r.nombre_rol,u.foto_url,u.foto_pos`;
export async function userById(db, id) {
  const {
    rows: [user],
  } = await db.query(
    `SELECT ${userColumns},u.auth_version FROM usuarios u JOIN rol r USING(id_rol) WHERE u.id_usuarios=$1`,
    [id],
  );
  return user;
}
export function publicUser(user) {
  // Proyección explícita: nuevas columnas privadas no se filtran accidentalmente al cliente.
  return {
    id_usuarios: user.id_usuarios,
    nombres_completos: user.nombres_completos,
    nombre: user.nombres_completos,
    tipo_documento: user.tipo_documento,
    numero_documento: user.numero_documento,
    correo: user.correo,
    telefono: user.telefono,
    fecha_nacimiento: user.fecha_nacimiento,
    estado: user.estado,
    id_rol: user.id_rol,
    nombre_rol: user.nombre_rol,
    foto_url: user.foto_url,
    foto_pos: user.foto_pos,
  };
}

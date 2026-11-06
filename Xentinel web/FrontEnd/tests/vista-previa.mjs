/** Servidor QA en memoria: no reenvía peticiones a la base de datos ni envía correos. */
import { createServer as crearServidor } from 'vite';
const personas = [
  {
    id_usuarios: 1,
    nombres_completos: 'Ana Demostración',
    nombre_rol: 'Administrador',
    id_rol: 3,
    numero_documento: 'admin-demo',
    correo: 'ana@example.com',
    estado: 'Activo',
    tipo_documento: 'CC',
  },
  {
    id_usuarios: 2,
    nombres_completos: 'Carlos Demostración',
    nombre_rol: 'Instructor',
    id_rol: 2,
    numero_documento: 'instructor-demo',
    correo: 'carlos@example.com',
    estado: 'Activo',
    tipo_documento: 'CC',
  },
  {
    id_usuarios: 3,
    nombres_completos: 'Camilo Demostración',
    nombre_rol: 'Celador',
    id_rol: 4,
    numero_documento: 'celador-demo',
    correo: 'camilo@example.com',
    estado: 'Activo',
  },
  {
    id_usuarios: 4,
    nombres_completos: 'Laura Demostración',
    nombre_rol: 'Aprendiz',
    id_rol: 1,
    numero_documento: 'visitante-demo',
    correo: 'laura@example.com',
    estado: 'Activo',
  },
];
const fichas = [
  {
    id_ficha: 1,
    id_programa: 1,
    numero_ficha: 'DEMO-2026',
    nombre_programa: 'Análisis y desarrollo de software',
    jornada: 'Diurna',
    modalidad: 'Presencial',
    fecha_inicio: '2026-01-15',
    fecha_fin: '2027-12-15',
  },
  {
    id_ficha: 2,
    id_programa: 2,
    numero_ficha: 'DEMO-2027',
    nombre_programa: 'Diseño e integración multimedia',
    jornada: 'Mixta',
    modalidad: 'Presencial',
    fecha_inicio: '2026-04-01',
    fecha_fin: '2028-04-01',
  },
];
const accesos = Array.from({ length: 9 }, (_, indice) => ({
  id_acceso: indice + 1,
  id_usuarios: 2,
  tipo: indice % 3 === 0 ? 'SALIDA' : 'ENTRADA',
  fechahora: new Date(Date.now() - indice * 43000000).toISOString(),
  estado: 'Permitido',
  metodo: 'Manual',
}));
const horarios = [
  {
    id_horario: 1,
    nombre_clase: 'Desarrollo de interfaces',
    dia_semana: 'Lunes',
    hora_inicio: '08:00:00',
    hora_fin: '12:00:00',
    ambiente: 'Ambiente 301',
    id_ficha: 1,
  },
  {
    id_horario: 2,
    nombre_clase: 'Arquitectura de software',
    dia_semana: 'Martes',
    hora_inicio: '09:00:00',
    hora_fin: '12:00:00',
    ambiente: 'Laboratorio 02',
    id_ficha: 1,
  },
  {
    id_horario: 3,
    nombre_clase: 'Bases de datos',
    dia_semana: 'Miércoles',
    hora_inicio: '08:00:00',
    hora_fin: '11:00:00',
    ambiente: 'Ambiente 304',
    id_ficha: 1,
  },
  {
    id_horario: 4,
    nombre_clase: 'Proyecto formativo',
    dia_semana: 'Jueves',
    hora_inicio: '10:00:00',
    hora_fin: '12:00:00',
    ambiente: 'Laboratorio 01',
    id_ficha: 1,
  },
  {
    id_horario: 5,
    nombre_clase: 'Experiencia de usuario',
    dia_semana: 'Viernes',
    hora_inicio: '08:00:00',
    hora_fin: '11:00:00',
    ambiente: 'Ambiente 301',
    id_ficha: 2,
  },
];
const alertas = [];
const complemento = {
  name: 'api-qa-aislada',
  configureServer(servidor) {
    servidor.middlewares.use(async (peticion, respuesta, siguiente) => {
      if (!peticion.url.startsWith('/api/v1')) return siguiente();
      respuesta.setHeader('Content-Type', 'application/json');
      respuesta.setHeader('Cache-Control', 'no-store');
      let cuerpo = {};
      try {
        let texto = '';
        for await (const fragmento of peticion) texto += fragmento;
        if (texto) cuerpo = JSON.parse(texto);
      } catch {
        respuesta.statusCode = 400;
        return respuesta.end('{}');
      }
      const ruta = peticion.url.split('?')[0].replace('/api/v1', '');
      const usuario = personas.find(
        (persona) =>
          peticion.headers.authorization === `Bearer qa-${persona.id_usuarios}`
      );
      const enviar = (datos, estado = 200) => {
        respuesta.statusCode = estado;
        respuesta.end(JSON.stringify({ data: datos }));
      };
      const fallar = (mensaje, estado = 400, codigo = 'ERROR_QA') => {
        respuesta.statusCode = estado;
        respuesta.end(
          JSON.stringify({ error: { message: mensaje, code: codigo } })
        );
      };
      if (ruta === '/auth/login') {
        const persona = personas.find(
          (persona) => persona.numero_documento === cuerpo.documento
        );
        return persona && cuerpo.contrasena === 'demo-password-12'
          ? enviar({
              access_token: `qa-${persona.id_usuarios}`,
              usuario: persona,
              expires_in: 900,
            })
          : fallar('Documento o contraseña incorrectos.', 401);
      }
      if (ruta === '/auth/validar-recuperacion')
        return cuerpo.token === 'a'.repeat(64) &&
          cuerpo.correo === 'demo@example.com'
          ? enviar({ valid: true })
          : fallar(
              'El enlace es inválido, venció o ya fue utilizado.',
              400,
              'INVALID_RESET_TOKEN'
            );
      if (ruta === '/auth/olvide-contrasena')
        return enviar({ message: 'Solicitud recibida' }, 202);
      if (ruta === '/auth/restablecer-contrasena')
        return fallar(
          'QA no modifica contraseñas. El contrato se verifica con pruebas unitarias.',
          409
        );
      if (!usuario) return fallar('Inicia sesión', 401);
      if (ruta === '/auth/me') return enviar(usuario);
      if (ruta === '/auth/logout') {
        respuesta.statusCode = 204;
        return respuesta.end();
      }
      if (ruta === '/ingresos' && peticion.method === 'GET')
        return enviar(accesos);
      if (ruta === '/ingresos' && peticion.method === 'POST') {
        if (
          !personas.some(
            (persona) => persona.id_usuarios === cuerpo.id_usuarios
          )
        )
          return fallar('Usuario no encontrado', 404);
        const previo = accesos.find(
          (registro) => registro.request_id === cuerpo.request_id
        );
        if (previo) return enviar(previo);
        const nuevo = {
          ...cuerpo,
          id_acceso: accesos.length + 1,
          fechahora: new Date().toISOString(),
          estado: 'Permitido',
        };
        accesos.unshift(nuevo);
        return enviar(nuevo, 201);
      }
      if (ruta === '/usuarios' && peticion.method === 'GET')
        return usuario.id_usuarios === 1
          ? enviar(personas)
          : fallar('No autorizado', 403);
      if (/^\/usuarios\/\d+\/fichas$/.test(ruta)) return enviar(fichas);
      if (/^\/usuarios\/\d+$/.test(ruta))
        return enviar(
          personas.find(
            (persona) => persona.id_usuarios === Number(ruta.split('/').at(-1))
          )
        );
      if (ruta === '/roles')
        return enviar(
          personas.map((persona) => ({
            id_rol: persona.id_rol,
            nombre_rol: persona.nombre_rol,
          }))
        );
      if (ruta === '/fichas') return enviar(fichas);
      if (ruta === '/horarios') return enviar(horarios);
      if (ruta === '/asistencias')
        return enviar([
          {
            id_asistencia: 1,
            id_jornada: 1,
            fecha: new Date().toISOString().slice(0, 10),
            hora_entrada: '08:00:00',
            hora_salida: null,
            estado: 'Presente',
          },
        ]);
      if (ruta === '/programas')
        return enviar(
          fichas.map((ficha) => ({
            id_programa: ficha.id_programa,
            nombre_programa: ficha.nombre_programa,
            nivel_programa: 'Tecnología',
          }))
        );
      if (ruta === '/jornadas')
        return enviar([
          {
            id_jornada: 1,
            id_ficha: 1,
            nombre: 'Mañana',
            hora_inicio: '08:00:00',
            hora_fin: '12:00:00',
          },
        ]);
      if (ruta === '/alertas/activas')
        return enviar(alertas.filter((alerta) => alerta.activa));
      if (ruta === '/alertas' && peticion.method === 'GET')
        return enviar(alertas);
      if (ruta === '/alertas' && peticion.method === 'POST') {
        const alerta = {
          ...cuerpo,
          id_alerta: alertas.length + 1,
          activa: true,
        };
        alertas.push(alerta);
        return enviar(alerta, 201);
      }
      if (/^\/alertas\/\d+\/cerrar$/.test(ruta)) {
        const alerta = alertas.find(
          (alerta) => alerta.id_alerta === Number(ruta.split('/')[2])
        );
        if (!alerta) return fallar('No encontrada', 404);
        alerta.activa = false;
        return enviar(alerta);
      }
      if (/^\/alertas\/\d+\/(reportes|sos)$/.test(ruta)) return enviar([]);
      return fallar(
        'Operación no implementada en el entorno aislado de QA',
        501
      );
    });
  },
};
const servidor = await crearServidor({
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('') },
  plugins: [complemento],
  server: { host: '127.0.0.1', port: 5176, strictPort: true, proxy: {} },
});
await servidor.listen();
servidor.printUrls();

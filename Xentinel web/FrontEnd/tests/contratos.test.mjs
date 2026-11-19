/** Contratos críticos del frontend: sesión, roles, transporte, recuperación y QR, sin conectar al backend real. */
import { test as probar, beforeEach as antesDeCadaPrueba } from 'node:test';
import comprobar from 'node:assert/strict';
import {
  rolParaUsuario,
  inicioParaUsuario,
  destinoTrasAcceso,
} from '../src/configuracion/navegacion.js';
import { solicitar, ErrorApi } from '../src/compartido/servicios/cliente.js';
import {
  guardarSesion,
  leerSesion,
} from '../src/compartido/servicios/sesion.js';
import {
  errorContrasena,
  verificarCodigo,
  restablecerContrasena,
} from '../src/compartido/servicios/recuperacion.js';
import {
  crearContenidoQr,
  interpretarContenidoQr,
  leerCodigoAcceso,
} from '../src/compartido/utilidades/codigoQr.js';
import {
  normalizarDia,
  construirMes,
  progresoFicha,
  claveFechaLocal,
} from '../src/modulos/instructor/calendario.js';
const almacenamiento = new Map();
globalThis.sessionStorage = {
  getItem: (clave) => almacenamiento.get(clave) || null,
  setItem: (clave, valor) => almacenamiento.set(clave, valor),
  removeItem: (clave) => almacenamiento.delete(clave),
};
globalThis.window = new EventTarget();
antesDeCadaPrueba(() => guardarSesion(null));
const sesion = () => ({
  tokenAcceso: 'token-solo-pruebas',
  usuario: { id_usuarios: 7 },
  venceEn: Date.now() + 60000,
});
probar('normaliza cuatro módulos y conserva el rol por nombre', () => {
  comprobar.equal(
    rolParaUsuario({ nombre_rol: 'Instructor', id_rol: 3 }),
    'instructor'
  );
  comprobar.equal(rolParaUsuario({ nombre_rol: 'Aprendiz' }), 'visitante');
  comprobar.equal(rolParaUsuario({ nombre_rol: 'Celador' }), 'celador');
  comprobar.equal(inicioParaUsuario(null), '/login');
});
probar(
  'login siempre aterriza en dashboard, incluso con ruta previa a contraseña',
  () => {
    const usuario = { nombre_rol: 'Administrador' };
    for (const destino of [
      'https://example.com',
      '//example.com',
      '/admin?modulo=perfil',
      '/instructor',
      '/restablecer-contrasena',
    ])
      comprobar.equal(destinoTrasAcceso(usuario, destino), '/admin');
  }
);
probar('caducidad impide autorizar solicitudes', () => {
  guardarSesion({ ...sesion(), venceEn: Date.now() - 1 });
  comprobar.equal(leerSesion(), null);
});
probar('Bearer y envoltura data/meta mantienen contrato HTTP', async () => {
  guardarSesion(sesion());
  globalThis.fetch = async (direccion, opciones) => {
    comprobar.equal(direccion, '/api/v1/usuarios');
    comprobar.equal(
      opciones.headers.Authorization,
      'Bearer token-solo-pruebas'
    );
    return Response.json({ data: [], meta: { limit: 25 } });
  };
  comprobar.deepEqual(await solicitar('/usuarios'), {
    data: [],
    meta: { limit: 25 },
  });
});
probar('solicitud pública no envía token', async () => {
  guardarSesion(sesion());
  globalThis.fetch = async (_, opciones) => {
    comprobar.equal(opciones.headers.Authorization, undefined);
    return Response.json({ data: {} });
  };
  await solicitar('/auth/login', { publicRequest: true });
});
probar('401 protegido caduca sesión y emite aviso', async () => {
  guardarSesion(sesion());
  let caducada = false;
  window.addEventListener(
    'xentinel:session-expired',
    () => {
      caducada = true;
    },
    { once: true }
  );
  globalThis.fetch = async () =>
    Response.json({ error: { message: 'Sesión vencida' } }, { status: 401 });
  await comprobar.rejects(solicitar('/usuarios'), ErrorApi);
  comprobar.equal(leerSesion(), null);
  comprobar.equal(caducada, true);
});
probar('error 422 conserva validación por campo', async () => {
  globalThis.fetch = async () =>
    Response.json(
      {
        error: {
          message: 'Revisa los datos',
          code: 'VALIDATION',
          fields: [{ path: 'correo', message: 'Inválido' }],
        },
      },
      { status: 422 }
    );
  await comprobar.rejects(
    solicitar('/usuarios'),
    (error) => error.status === 422 && error.fields[0].path === 'correo'
  );
});
probar('204 y respuesta inesperada se distinguen', async () => {
  globalThis.fetch = async () => new Response(null, { status: 204 });
  comprobar.deepEqual(await solicitar('/auth/logout', { method: 'POST' }), {
    data: null,
  });
  globalThis.fetch = async () => Response.json({ inesperada: true });
  await comprobar.rejects(solicitar('/usuarios'), /inesperada/);
});
probar('error de red permite reintento sin perder sesión', async () => {
  guardarSesion(sesion());
  globalThis.fetch = async () => {
    throw new TypeError('red');
  };
  await comprobar.rejects(solicitar('/usuarios'), /conectar/);
  comprobar.ok(leerSesion());
});
probar('cancelación aborta el transporte', async () => {
  const controlador = new AbortController();
  controlador.abort();
  globalThis.fetch = async (_, opciones) => {
    comprobar.equal(opciones.signal.aborted, true);
    throw new DOMException('Cancelado', 'AbortError');
  };
  await comprobar.rejects(
    solicitar('/usuarios', { signal: controlador.signal }),
    (error) => error.name === 'AbortError'
  );
});
probar('recuperación exige confirmación positiva del código', async () => {
  globalThis.fetch = async (direccion, opciones) => {
    comprobar.equal(direccion, '/api/v1/auth/validar-recuperacion');
    comprobar.deepEqual(JSON.parse(opciones.body), {
      correo: 'demo@example.com',
      codigo: '482915',
    });
    return Response.json({ data: { valid: false } });
  };
  await comprobar.rejects(
    verificarCodigo('demo@example.com', '482915'),
    /válido/
  );
  globalThis.fetch = async () => Response.json({ data: { valid: true } });
  await verificarCodigo('demo@example.com', '482915');
});
probar('cambio vuelve a enviar correo y código al servidor', async () => {
  globalThis.fetch = async (direccion, opciones) => {
    comprobar.equal(direccion, '/api/v1/auth/restablecer-contrasena');
    comprobar.deepEqual(JSON.parse(opciones.body), {
      correo: 'demo@example.com',
      codigo: '482915',
      contrasena: 'contrasena-de-prueba',
    });
    return Response.json({ data: { message: 'Listo' } });
  };
  await restablecerContrasena(
    'demo@example.com',
    '482915',
    'contrasena-de-prueba'
  );
});
probar('contraseñas respetan mínimo y bytes UTF-8', () => {
  comprobar.notEqual(errorContrasena('corta'), '');
  comprobar.equal(errorContrasena('Una-clave-de-prueba'), '');
  comprobar.notEqual(errorContrasena('á'.repeat(37)), '');
});
probar('QR contiene solo ID, sistema y versión', () => {
  const contenido = crearContenidoQr(27);
  comprobar.deepEqual(JSON.parse(contenido), {
    sistema: 'Xentinel',
    version: 1,
    id_usuarios: 27,
  });
  comprobar.equal(interpretarContenidoQr(contenido), 27);
});
probar('lector web acepta el carnet de la app, firmado o heredado', () => {
  const firmado = 'XN2:51:119000000:34LXQRURWYGRTV45BUWW';
  comprobar.deepEqual(leerCodigoAcceso(` ${firmado} `), {
    id_usuarios: 51,
    codigo_qr: firmado,
  });
  comprobar.deepEqual(leerCodigoAcceso('XENTINEL:27:1790000000000'), {
    id_usuarios: 27,
  });
  comprobar.equal(interpretarContenidoQr(firmado), 51);
  for (const contenido of [
    'XN2:51:1:minusculas234567abcdef',
    'XN2:0:1:34LXQRURWYGRTV45BUWW',
    'XN2:9999999999:1:34LXQRURWYGRTV45BUWW',
    'XENTINEL:27',
  ])
    comprobar.throws(() => leerCodigoAcceso(contenido));
});
probar('lector rechaza QR ajeno, IDs inválidos y texto excesivo', () => {
  for (const contenido of [
    '27',
    'https://example.com',
    'a'.repeat(401),
    '{}',
    JSON.stringify({ sistema: 'Xentinel', version: 1, id_usuarios: -1 }),
    JSON.stringify({ sistema: 'Xentinel', version: 2, id_usuarios: 1 }),
  ])
    comprobar.throws(() => interpretarContenidoQr(contenido));
});
probar('calendario reconoce acentos y conserva fechas locales', () => {
  comprobar.equal(normalizarDia('miércoles'), 2);
  comprobar.equal(normalizarDia('SABADO'), 5);
  comprobar.equal(normalizarDia('desconocido'), -1);
  const dias = construirMes(new Date(2026, 9, 1));
  comprobar.equal(dias.length, 42);
  comprobar.equal(dias[0].getDay(), 1);
  comprobar.equal(claveFechaLocal(new Date(2026, 9, 1)), '2026-10-01');
});
probar('avance académico no inventa porcentajes para fechas inválidas', () => {
  comprobar.equal(progresoFicha('', ''), null);
  comprobar.equal(
    progresoFicha('2026-01-01', '2026-12-31', Date.parse('2025-01-01')),
    0
  );
  comprobar.equal(
    progresoFicha('2026-01-01', '2026-12-31', Date.parse('2027-01-01')),
    100
  );
});

// Contrato de publicación Android: conserva la validación existente al traducir su implementación.
import { validarVersion } from '../public/descargarAplicacion.mjs';
const versionValida = {
  available: true,
  packageId: 'co.edu.sena.xentinel',
  version: '1.2.3',
  versionCode: 4,
  sizeBytes: 120,
  sha256: 'a'.repeat(64),
  url: '/downloads/xentinel-1.2.3-4.apk',
};
probar('publicación no disponible no expone instalador', () =>
  comprobar.equal(
    validarVersion({ available: false }, 'https://ejemplo.com/Descarga.html'),
    null
  )
);
probar('publicación válida mantiene URL del mismo origen', () =>
  comprobar.equal(
    validarVersion(versionValida, 'https://ejemplo.com/Descarga.html').url,
    'https://ejemplo.com/downloads/xentinel-1.2.3-4.apk'
  )
);
probar('publicación rechaza origen ajeno y huella inválida', () => {
  comprobar.throws(() =>
    validarVersion(
      {
        ...versionValida,
        url: 'https://otro.com/downloads/xentinel-1.2.3-4.apk',
      },
      'https://ejemplo.com/Descarga.html'
    )
  );
  comprobar.throws(() =>
    validarVersion(
      { ...versionValida, sha256: 'invalida' },
      'https://ejemplo.com/Descarga.html'
    )
  );
});

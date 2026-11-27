/** Datos y rutas simuladas de programas, fichas, carga masiva, reportes y escaneo para la
 * vista previa QA. Todo vive en memoria; nada llega a una base de datos. */
const NOMBRES = [
  'Andrés Torres',
  'Beatriz Gómez',
  'Camila Ruiz',
  'Diego Pardo',
  'Esteban Mora',
  'Fernanda Castro',
  'Gabriel Niño',
  'Helena Rojas',
  'Iván Salcedo',
  'Juliana Vega',
  'Kevin Ospina',
  'Lorena Díaz',
  'Mateo Quintero',
  'Natalia Prieto',
];

export function crearDatosAcademicos(personas, horarios) {
  const programas = [
    {
      id_programa: 1,
      nombre_programa: 'Análisis y desarrollo de software',
      nivel_programa: 'Tecnólogo',
      activo: true,
    },
    {
      id_programa: 2,
      nombre_programa: 'Diseño e integración multimedia',
      nivel_programa: 'Técnico',
      activo: true,
    },
    {
      id_programa: 3,
      nombre_programa: 'Gestión logística',
      nivel_programa: 'Tecnólogo',
      activo: true,
    },
  ];
  const fichas = [
    {
      id_ficha: 1,
      id_programa: 1,
      numero_ficha: '2675859',
      nombre_ficha: 'ADSO 2026 mañana',
      jornada: 'Mañana',
      hora_inicio: '06:30:00',
      hora_fin: '12:00:00',
      modalidad: 'Presencial',
      fecha_inicio: '2026-01-20',
      fecha_fin: '2027-12-10',
    },
    {
      id_ficha: 2,
      id_programa: 1,
      numero_ficha: '2675860',
      nombre_ficha: 'ADSO 2026 noche',
      jornada: 'Noche',
      hora_inicio: '18:00:00',
      hora_fin: '22:00:00',
      modalidad: 'Presencial',
      fecha_inicio: '2026-02-02',
      fecha_fin: '2028-01-28',
    },
    {
      id_ficha: 3,
      id_programa: 2,
      numero_ficha: '2701144',
      nombre_ficha: null,
      jornada: 'Tarde',
      hora_inicio: '12:30:00',
      hora_fin: '18:00:00',
      modalidad: 'Mixta',
      fecha_inicio: '2026-04-01',
      fecha_fin: '2027-03-30',
    },
    {
      id_ficha: 4,
      id_programa: 3,
      numero_ficha: '2710032',
      nombre_ficha: 'Logística empresarial',
      jornada: null,
      hora_inicio: null,
      hora_fin: null,
      modalidad: 'Presencial',
      fecha_inicio: null,
      fecha_fin: null,
    },
  ];
  const aprendices = NOMBRES.map((nombre, indice) => ({
    id_usuarios: 40 + indice,
    nombres_completos: nombre,
    nombre_rol: 'Aprendiz',
    id_rol: 1,
    tipo_documento: indice % 3 ? 'TI' : 'CC',
    numero_documento: String(1023400100 + indice * 7),
    correo: `${nombre.split(' ')[0].toLowerCase()}@ejemplo.com`,
    estado: 'Activo',
    situacion_formativa: indice === 5 ? 'En inducción' : 'En formación',
    requiere_restablecimiento: indice === 9,
  }));
  personas.push(...aprendices);
  /* Ficha activa de cada aprendiz: 9 en la 2675859, 3 en la 2675860, 2 sin ficha. */
  const vinculos = new Map(
    aprendices.map((persona, indice) => [
      persona.id_usuarios,
      indice < 9
        ? { id_ficha: 1, fechaingreso: '2026-01-20' }
        : indice < 12
          ? { id_ficha: 2, fechaingreso: '2026-02-02' }
          : null,
    ])
  );
  return { programas, fichas, vinculos, horarios, personas };
}

const nombreRol = (persona) => persona.nombre_rol?.toLowerCase();

export function atenderAcademico(datos, solicitud) {
  const { programas, fichas, vinculos, horarios, personas } = datos;
  const { ruta, metodo, cuerpo, url, enviar, fallar, sinContenido } = solicitud;
  const consulta = new URL(url, 'http://qa').searchParams;
  const programaDe = (id) => programas.find((p) => p.id_programa === id);
  const aprendicesDe = (idFicha) =>
    [...vinculos.entries()]
      .filter(([, vinculo]) => vinculo?.id_ficha === idFicha)
      .map(([id, vinculo]) => {
        const persona = personas.find((p) => p.id_usuarios === id);
        return {
          ...persona,
          estado_ficha: 'En formación',
          fechaingreso: vinculo.fechaingreso,
          requiere_activacion: !!persona.requiere_restablecimiento,
        };
      })
      .sort((a, b) => a.nombres_completos.localeCompare(b.nombres_completos));
  const horariosDe = (idFicha) =>
    horarios
      .filter((h) => h.id_ficha === idFicha)
      .map((h) => ({
        ...h,
        instructor:
          h.id_instructor === 2 ? 'Carlos Demostración' : 'Marta Instructora',
      }));
  const resumenFicha = (ficha) => ({
    ...ficha,
    nombre_programa: programaDe(ficha.id_programa)?.nombre_programa,
    nivel_programa: programaDe(ficha.id_programa)?.nivel_programa,
    total_aprendices: aprendicesDe(ficha.id_ficha).length,
    total_horarios: horariosDe(ficha.id_ficha).length,
  });
  const detalleFicha = (ficha) => ({
    ...resumenFicha(ficha),
    aprendices: aprendicesDe(ficha.id_ficha),
    horarios: horariosDe(ficha.id_ficha),
  });
  const formacion = (persona) => {
    const vinculo = vinculos.get(persona.id_usuarios);
    const ficha =
      vinculo && fichas.find((f) => f.id_ficha === vinculo.id_ficha);
    return ficha
      ? {
          id_ficha: ficha.id_ficha,
          numero_ficha: ficha.numero_ficha,
          nombre_ficha: ficha.nombre_ficha,
          id_programa: ficha.id_programa,
          nombre_programa: programaDe(ficha.id_programa)?.nombre_programa,
        }
      : null;
  };
  let partes;

  if (ruta === '/programas' && metodo === 'GET') {
    const activo = consulta.get('activo');
    return enviar(
      programas
        .filter((p) => activo === null || String(p.activo) === activo)
        .map((p) => {
          const propias = fichas.filter((f) => f.id_programa === p.id_programa);
          return {
            ...p,
            total_fichas: propias.length,
            total_aprendices: propias.reduce(
              (total, f) => total + aprendicesDe(f.id_ficha).length,
              0
            ),
          };
        })
    );
  }
  if (ruta === '/programas' && metodo === 'POST') {
    const nuevo = {
      id_programa: programas.length + 1,
      nombre_programa: cuerpo.nombre_programa,
      nivel_programa: cuerpo.nivel_programa,
      activo: true,
    };
    programas.push(nuevo);
    return enviar({ ...nuevo, fichas: [] }, 201);
  }
  if ((partes = /^\/programas\/(\d+)$/.exec(ruta))) {
    const programa = programaDe(Number(partes[1]));
    if (!programa) return fallar('Programa no encontrado', 404);
    if (metodo === 'PATCH') Object.assign(programa, cuerpo);
    if (metodo === 'DELETE') {
      programas.splice(programas.indexOf(programa), 1);
      return sinContenido();
    }
    return enviar({
      ...programa,
      fichas: fichas
        .filter((f) => f.id_programa === programa.id_programa)
        .map(detalleFicha),
    });
  }
  if (ruta === '/fichas' && metodo === 'GET') {
    const texto = (consulta.get('buscar') ?? '').toLowerCase();
    const programa = Number(consulta.get('id_programa')) || null;
    return enviar(
      fichas
        .map(resumenFicha)
        .filter(
          (f) =>
            (!programa || f.id_programa === programa) &&
            (!texto ||
              `${f.numero_ficha} ${f.nombre_ficha ?? ''} ${f.nombre_programa}`
                .toLowerCase()
                .includes(texto))
        )
        .reverse()
    );
  }
  if (ruta === '/fichas' && metodo === 'POST') {
    if (fichas.some((f) => f.numero_ficha === cuerpo.numero_ficha))
      return fallar(
        `Ya existe la ficha ${cuerpo.numero_ficha}`,
        409,
        'DUPLICATE_FICHA'
      );
    const nueva = {
      ...cuerpo,
      id_ficha: fichas.length + 1,
      hora_inicio: cuerpo.hora_inicio && `${cuerpo.hora_inicio}:00`,
      hora_fin: cuerpo.hora_fin && `${cuerpo.hora_fin}:00`,
    };
    fichas.push(nueva);
    return enviar(detalleFicha(nueva), 201);
  }
  if ((partes = /^\/fichas\/(\d+)$/.exec(ruta))) {
    const ficha = fichas.find((f) => f.id_ficha === Number(partes[1]));
    if (!ficha) return fallar('Ficha no encontrada', 404);
    if (metodo === 'PATCH')
      Object.assign(ficha, cuerpo, {
        hora_inicio: cuerpo.hora_inicio && `${cuerpo.hora_inicio}:00`,
        hora_fin: cuerpo.hora_fin && `${cuerpo.hora_fin}:00`,
      });
    if (metodo === 'DELETE') {
      if (aprendicesDe(ficha.id_ficha).length)
        return fallar(
          'La ficha tiene asistencia o pases de lista registrados. Desvincula a sus aprendices en lugar de eliminarla.',
          409
        );
      fichas.splice(fichas.indexOf(ficha), 1);
      return sinContenido();
    }
    return enviar(detalleFicha(ficha));
  }
  if ((partes = /^\/fichas\/(\d+)\/aprendices$/.exec(ruta))) {
    const id = Number(partes[1]);
    const resultado = {
      asignados: [],
      trasladados: [],
      ya_estaban: [],
      rechazados: [],
    };
    for (const persona of personas.filter((p) =>
      cuerpo.ids.includes(p.id_usuarios)
    )) {
      const resumen = {
        id_usuarios: persona.id_usuarios,
        nombre: persona.nombres_completos,
      };
      if (nombreRol(persona) !== 'aprendiz') {
        resultado.rechazados.push({
          ...resumen,
          motivo: 'Solo los aprendices se vinculan a una ficha',
        });
        continue;
      }
      const anterior = vinculos.get(persona.id_usuarios);
      if (anterior?.id_ficha === id) resultado.ya_estaban.push(resumen);
      else
        (anterior ? resultado.trasladados : resultado.asignados).push(resumen);
      vinculos.set(persona.id_usuarios, {
        id_ficha: id,
        fechaingreso: '2026-11-27',
      });
    }
    return enviar({
      ...resultado,
      ficha: detalleFicha(fichas.find((f) => f.id_ficha === id)),
    });
  }
  if ((partes = /^\/fichas\/(\d+)\/aprendices\/(\d+)$/.exec(ruta))) {
    vinculos.set(Number(partes[2]), null);
    return sinContenido();
  }
  if ((partes = /^\/fichas\/(\d+)\/horarios$/.exec(ruta))) {
    const id = Number(partes[1]);
    for (let i = horarios.length - 1; i >= 0; i -= 1)
      if (horarios[i].id_ficha === id) horarios.splice(i, 1);
    cuerpo.horarios.forEach((h, indice) =>
      horarios.push({
        ...h,
        id_horario: h.id_horario ?? 100 + indice,
        id_ficha: id,
        hora_inicio: `${h.hora_inicio.slice(0, 5)}:00`,
        hora_fin: `${h.hora_fin.slice(0, 5)}:00`,
      })
    );
    return enviar(detalleFicha(fichas.find((f) => f.id_ficha === id)));
  }
  if ((partes = /^\/usuarios\/documento\/(.+)$/.exec(ruta))) {
    const persona = personas.find(
      (p) => p.numero_documento === decodeURIComponent(partes[1])
    );
    return persona
      ? enviar(persona)
      : fallar('No hay ninguna persona con ese documento', 404, 'NOT_FOUND');
  }
  if (ruta === '/programas/instructores')
    return enviar([
      { id_usuarios: 2, nombres_completos: 'Carlos Demostración' },
      { id_usuarios: 9, nombres_completos: 'Marta Instructora' },
    ]);
  if (ruta === '/usuarios' && metodo === 'GET') {
    const texto = (consulta.get('buscar') ?? '').toLowerCase();
    const rol = Number(consulta.get('id_rol')) || null;
    const estado = consulta.get('estado');
    return enviar(
      personas
        .filter(
          (p) =>
            (!rol || p.id_rol === rol) &&
            (!estado || p.estado === estado) &&
            (!texto ||
              `${p.nombres_completos} ${p.numero_documento} ${p.correo}`
                .toLowerCase()
                .includes(texto))
        )
        .map((p) => ({ ...p, formacion: formacion(p) })),
      200,
      { totales: { activos: personas.length, inactivos: 0 } }
    );
  }
  if ((partes = /^\/usuarios\/(\d+)$/.exec(ruta)) && metodo === 'GET') {
    const persona = personas.find((p) => p.id_usuarios === Number(partes[1]));
    return persona
      ? enviar({ ...persona, formacion: formacion(persona) })
      : fallar('Usuario no encontrado', 404, 'NOT_FOUND');
  }
  if (ruta === '/usuarios' && metodo === 'POST') {
    const nueva = {
      ...cuerpo,
      id_usuarios: 200 + personas.length,
      nombre_rol: cuerpo.id_rol === 1 ? 'Aprendiz' : 'Instructor',
      estado: 'Activo',
    };
    delete nueva.contrasena;
    personas.push(nueva);
    if (cuerpo.id_ficha)
      vinculos.set(nueva.id_usuarios, {
        id_ficha: cuerpo.id_ficha,
        fechaingreso: '2026-11-27',
      });
    return enviar({ ...nueva, formacion: formacion(nueva) }, 201);
  }
  if (ruta === '/usuarios/importar') {
    const vistos = new Map();
    const revisadas = cuerpo.filas.map((fila, indice) => {
      const errores = [];
      const avisos = [];
      if (!fila.nombres_completos) errores.push('Falta el nombre completo');
      if (!fila.correo) errores.push('Falta el correo');
      else if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(fila.correo))
        errores.push('Correo no válido');
      if (!fila.numero_documento) errores.push('Falta el número de documento');
      else if (vistos.has(fila.numero_documento))
        errores.push(
          `Documento repetido en el archivo (fila ${vistos.get(fila.numero_documento)})`
        );
      else if (
        personas.some((p) => p.numero_documento === fila.numero_documento)
      )
        errores.push('Ya existe una persona con este documento');
      else vistos.set(fila.numero_documento, indice + 1);
      const ficha = fichas.find((f) => f.numero_ficha === fila.numero_ficha);
      let nueva = false;
      if (fila.numero_ficha && !ficha) {
        const programa = programas.find(
          (p) =>
            p.nombre_programa.toLowerCase() ===
            (fila.programa ?? '').toLowerCase()
        );
        if (!fila.programa)
          errores.push(
            `La ficha ${fila.numero_ficha} no existe: escribe el programa para crearla`
          );
        else if (!programa)
          errores.push(`El programa «${fila.programa}» no existe`);
        else {
          nueva = true;
          avisos.push(`Se creará la ficha ${fila.numero_ficha}`);
        }
      }
      if (!fila.tipo_documento)
        avisos.push('Sin tipo de documento: se usará CC');
      return {
        fila: indice + 1,
        datos: {
          ...fila,
          tipo_documento: fila.tipo_documento ?? 'CC',
          rol: fila.rol ?? 'Aprendiz',
          programa: ficha
            ? programaDe(ficha.id_programa).nombre_programa
            : fila.programa,
        },
        errores,
        avisos,
        valida: !errores.length,
        ficha_nueva: nueva && !errores.length,
      };
    });
    const validas = revisadas.filter((f) => f.valida);
    const numeros = new Set(
      validas.map((f) => f.datos.numero_ficha).filter(Boolean)
    );
    const nuevas = new Set(
      validas.filter((f) => f.ficha_nueva).map((f) => f.datos.numero_ficha)
    );
    if (cuerpo.simular)
      return enviar({
        resumen: {
          total: revisadas.length,
          validas: validas.length,
          errores: revisadas.length - validas.length,
          fichas: numeros.size,
          fichas_nuevas: nuevas.size,
        },
        filas: revisadas,
      });
    return enviar(
      {
        resumen: {
          creados: validas.length,
          fichas_actualizadas: numeros.size,
          fichas_creadas: nuevas.size,
          omitidos: revisadas.length - validas.length,
        },
        filas: revisadas.filter((f) => !f.valida),
      },
      201
    );
  }
  if (ruta === '/reportes/accesos') {
    const fecha = consulta.get('fecha');
    const filas = personas.slice(4, 10).flatMap((persona, indice) =>
      ['ENTRADA', 'SALIDA'].map((tipo, orden) => ({
        id_acceso: indice * 2 + orden + 1,
        id_usuarios: persona.id_usuarios,
        tipo,
        fechahora: `${fecha}T${orden ? 17 : 11 + (indice % 2)}:${10 + indice}:00Z`,
        metodo: 'QR',
        estado: 'Permitido',
        nombres_completos: persona.nombres_completos,
        tipo_documento: persona.tipo_documento,
        numero_documento: persona.numero_documento,
        nombre_rol: persona.nombre_rol,
        ...(formacion(persona) ?? {}),
      }))
    );
    return enviar(filas, 200, { hasta: filas.length, siguiente: null });
  }
  if (ruta === '/reportes/asistencia')
    return enviar(
      personas.slice(0, 6).map((persona, indice) => ({
        id_asistencia: indice + 1,
        id_usuarios: persona.id_usuarios,
        fecha: consulta.get('fecha'),
        hora_entrada: `0${6 + (indice % 3)}:5${indice}:00`,
        hora_salida: indice % 2 ? '12:01:00' : null,
        estado: indice === 4 ? 'Retardo' : 'Presente',
        nombres_completos: persona.nombres_completos,
        tipo_documento: persona.tipo_documento ?? 'CC',
        numero_documento: persona.numero_documento,
        nombre_rol: persona.nombre_rol,
        ...(formacion(persona) ?? {}),
      })),
      200,
      { hasta: 6, siguiente: null }
    );
  if (ruta === '/auth/credencial-qr')
    return enviar({
      version: 2,
      formato: 'XN2',
      id_usuarios: solicitud.usuario.id_usuarios,
      clave: Buffer.from('clave-qa-de-32-bytes-para-xn2-ok').toString(
        'base64url'
      ),
      paso_segundos: 15,
      ventana_pasos: 3,
      servidor_ms: Date.now(),
    });
  if (ruta === '/ingresos' && metodo === 'POST') {
    const id = cuerpo.codigo_qr
      ? Number(cuerpo.codigo_qr.split(':')[1])
      : cuerpo.id_usuarios;
    const persona = personas.find((p) => p.id_usuarios === id);
    if (!persona) return fallar('Usuario no encontrado', 404, 'NOT_FOUND');
    const ahora = new Date().toISOString();
    const permitido = persona.estado === 'Activo';
    const vinculo = formacion(persona);
    return enviar(
      {
        id_acceso: 900,
        id_usuarios: id,
        tipo: cuerpo.tipo,
        metodo: cuerpo.metodo,
        estado: permitido ? 'Permitido' : 'Denegado',
        fechahora: ahora,
        request_id: cuerpo.request_id,
        persona: {
          nombres_completos: persona.nombres_completos,
          tipo_documento: persona.tipo_documento ?? 'CC',
          numero_documento: persona.numero_documento,
          nombre_rol: persona.nombre_rol,
          estado: persona.estado,
          numero_ficha: vinculo?.numero_ficha,
          nombre_programa: vinculo?.nombre_programa,
          ambiente: 'Ambiente 301',
        },
        asistencia: permitido
          ? { estado: 'Presente', hora_entrada: '07:02:00' }
          : null,
        motivo: permitido
          ? null
          : { codigo: 'USUARIO_INACTIVO', mensaje: 'Usuario inactivo' },
      },
      201
    );
  }
  return false;
}

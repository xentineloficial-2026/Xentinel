/** Lectura de archivos de carga masiva (CSV o Excel) y plantillas para descargar. */

/** Columnas de la plantilla, en orden, con el campo que envía la API. */
export const COLUMNAS = [
  ['Nombre completo', 'nombres_completos', true],
  ['Tipo de documento', 'tipo_documento', false],
  ['Número de documento', 'numero_documento', true],
  ['Correo', 'correo', true],
  ['Teléfono', 'telefono', false],
  ['Fecha de nacimiento', 'fecha_nacimiento', false],
  ['Rol', 'rol', false],
  ['Número de ficha', 'numero_ficha', false],
  ['Programa de formación', 'programa', false],
];
export const MAXIMO_FILAS = 1000;

const EJEMPLOS = [
  [
    'Laura Valentina Ríos',
    'TI',
    '1023456789',
    'laura.rios@ejemplo.com',
    '3001234567',
    '2007-03-14',
    'Aprendiz',
    '2675859',
    'Análisis y desarrollo de software',
  ],
  [
    'Andrés Felipe Gómez',
    'CC',
    '1019876543',
    'andres.gomez@ejemplo.com',
    '',
    '',
    'Aprendiz',
    '2675859',
    '',
  ],
];

/* Encabezados aceptados, sin tildes ni mayúsculas. */
const SINONIMOS = {
  nombres_completos: [
    'nombre completo',
    'nombres completos',
    'nombre',
    'nombres y apellidos',
  ],
  tipo_documento: ['tipo de documento', 'tipo documento', 'tipo doc', 'tipo'],
  numero_documento: [
    'numero de documento',
    'numero documento',
    'documento',
    'no documento',
    'cedula',
  ],
  correo: ['correo', 'correo electronico', 'email', 'e-mail'],
  telefono: ['telefono', 'celular', 'telefono celular'],
  fecha_nacimiento: ['fecha de nacimiento', 'fecha nacimiento', 'nacimiento'],
  rol: ['rol', 'perfil'],
  numero_ficha: ['numero de ficha', 'numero ficha', 'ficha', 'no ficha'],
  programa: ['programa de formacion', 'programa', 'nombre del programa'],
};

export function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.#°º]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** CSV con «;» o «,», comillas dobles, saltos de línea dentro de comillas y BOM. */
export function leerCsv(texto) {
  const contenido = texto.replace(/^\uFEFF/, '');
  const primera = contenido.split(/\r?\n/, 1)[0] ?? '';
  const separador =
    (primera.match(/;/g)?.length ?? 0) >= (primera.match(/,/g)?.length ?? 0)
      ? ';'
      : ',';
  const filas = [];
  let fila = [];
  let celda = '';
  let comillas = false;
  for (let i = 0; i < contenido.length; i += 1) {
    const caracter = contenido[i];
    if (comillas) {
      if (caracter === '"' && contenido[i + 1] === '"') {
        celda += '"';
        i += 1;
      } else if (caracter === '"') comillas = false;
      else celda += caracter;
    } else if (caracter === '"') comillas = true;
    else if (caracter === separador) {
      fila.push(celda);
      celda = '';
    } else if (caracter === '\n' || caracter === '\r') {
      if (caracter === '\r' && contenido[i + 1] === '\n') i += 1;
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = '';
    } else celda += caracter;
  }
  if (celda !== '' || fila.length) {
    fila.push(celda);
    filas.push(fila);
  }
  return filas;
}

function texto(valor) {
  if (valor == null) return '';
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  if (typeof valor === 'object') {
    if ('text' in valor) return String(valor.text);
    if ('result' in valor) return texto(valor.result);
    if (Array.isArray(valor.richText))
      return valor.richText.map((parte) => parte.text).join('');
  }
  return String(valor);
}

/** Primera hoja de un .xlsx como matriz de textos (las fechas quedan en AAAA-MM-DD). */
export async function leerExcel(contenido) {
  const { default: Excel } = await import('exceljs/dist/exceljs.min.js');
  const libro = new Excel.Workbook();
  await libro.xlsx.load(contenido);
  const hoja = libro.worksheets[0];
  if (!hoja) return [];
  const filas = [];
  hoja.eachRow({ includeEmpty: false }, (fila) => {
    const valores = [];
    for (let columna = 1; columna <= hoja.columnCount; columna += 1)
      valores.push(texto(fila.getCell(columna).value));
    filas.push(valores);
  });
  return filas;
}

/**
 * Convierte la matriz leída en filas para la API. Reconoce los encabezados por nombre,
 * en cualquier orden, e ignora filas vacías y columnas desconocidas.
 */
export function interpretarFilas(matriz, { numeroFicha } = {}) {
  const [encabezados = [], ...resto] = matriz;
  const indices = {};
  encabezados.forEach((encabezado, indice) => {
    const limpio = normalizar(encabezado);
    for (const [campo, nombres] of Object.entries(SINONIMOS))
      if (indices[campo] === undefined && nombres.includes(limpio))
        indices[campo] = indice;
  });
  const faltantes = COLUMNAS.filter(
    ([, campo, obligatoria]) => obligatoria && indices[campo] === undefined
  ).map(([nombre]) => nombre);
  if (faltantes.length)
    throw new Error(
      `Al archivo le faltan columnas: ${faltantes.join(', ')}. Usa la plantilla para ver el formato.`
    );
  const filas = resto
    .filter((valores) => valores.some((valor) => String(valor ?? '').trim()))
    .map((valores) => {
      const fila = {};
      for (const [, campo] of COLUMNAS) {
        const valor =
          indices[campo] === undefined
            ? ''
            : String(valores[indices[campo]] ?? '').trim();
        if (valor) fila[campo] = valor.slice(0, 300);
      }
      if (numeroFicha && !fila.numero_ficha) fila.numero_ficha = numeroFicha;
      return fila;
    });
  if (!filas.length) throw new Error('El archivo no tiene filas con datos.');
  if (filas.length > MAXIMO_FILAS)
    throw new Error(
      `El archivo tiene ${filas.length} filas. Divide la carga en archivos de máximo ${MAXIMO_FILAS}.`
    );
  return filas;
}

export async function leerArchivo(archivo, opciones) {
  const nombre = archivo.name.toLowerCase();
  if (nombre.endsWith('.xlsx'))
    return interpretarFilas(
      await leerExcel(await archivo.arrayBuffer()),
      opciones
    );
  if (nombre.endsWith('.csv') || nombre.endsWith('.txt'))
    return interpretarFilas(leerCsv(await archivo.text()), opciones);
  throw new Error('Usa un archivo .csv o .xlsx (Excel).');
}

function descargar(blob, nombre) {
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(blob);
  enlace.download = nombre;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(enlace.href), 30000);
}

function filasPlantilla(numeroFicha) {
  return EJEMPLOS.map((fila) =>
    numeroFicha ? [...fila.slice(0, 7), numeroFicha, ''] : fila
  );
}

export function plantillaCsv(numeroFicha) {
  const lineas = [
    COLUMNAS.map(([nombre]) => nombre),
    ...filasPlantilla(numeroFicha),
  ]
    .map((fila) => fila.join(';'))
    .join('\r\n');
  return new Blob([`\uFEFF${lineas}\r\n`], { type: 'text/csv;charset=utf-8' });
}

export async function plantillaExcel(numeroFicha) {
  const { default: Excel } = await import('exceljs/dist/exceljs.min.js');
  const libro = new Excel.Workbook();
  libro.creator = 'Xentinel';
  const hoja = libro.addWorksheet('Personas', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  hoja.columns = COLUMNAS.map(([nombre]) => ({
    header: nombre,
    width: Math.max(16, nombre.length + 4),
    style: { numFmt: '@' },
  }));
  hoja.addRows(filasPlantilla(numeroFicha));
  hoja.getRow(1).font = { bold: true };
  const ayuda = libro.addWorksheet('Instrucciones');
  ayuda.columns = [{ width: 26 }, { width: 90 }];
  [
    ['Columna', 'Cómo llenarla'],
    ['Nombre completo', 'Obligatoria. Nombres y apellidos.'],
    [
      'Tipo de documento',
      'CC, TI, CE, PA, PEP o PPT. Si la dejas vacía se usa CC.',
    ],
    [
      'Número de documento',
      'Obligatoria. Sin puntos ni espacios. No puede repetirse.',
    ],
    [
      'Correo',
      'Obligatoria. Allí llega el código para que la persona cree su contraseña.',
    ],
    ['Teléfono', 'Opcional.'],
    ['Fecha de nacimiento', 'Opcional. AAAA-MM-DD o DD/MM/AAAA.'],
    [
      'Rol',
      'Aprendiz, Instructor, Celador, Funcionarios o Visitantes. Vacía = Aprendiz.',
    ],
    [
      'Número de ficha',
      'Opcional, solo para aprendices. Si la ficha no existe, escribe el programa para crearla.',
    ],
    [
      'Programa de formación',
      'Nombre exacto de un programa ya creado. Solo hace falta para crear fichas nuevas.',
    ],
    ['', ''],
    [
      'Antes de importar',
      'Xentinel revisa todo el archivo y muestra cada error. Solo se crean las filas sin errores.',
    ],
    [
      'Cuentas nuevas',
      'Cada persona crea su contraseña en «¿Olvidaste tu contraseña?» con el código que llega a su correo.',
    ],
  ].forEach((fila) => ayuda.addRow(fila));
  ayuda.getRow(1).font = { bold: true };
  descargar(
    new Blob([await libro.xlsx.writeBuffer()], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    'plantilla-carga-masiva-xentinel.xlsx'
  );
}

export function descargarPlantilla(formato, numeroFicha) {
  if (formato === 'xlsx') return plantillaExcel(numeroFicha);
  descargar(plantillaCsv(numeroFicha), 'plantilla-carga-masiva-xentinel.csv');
  return Promise.resolve();
}

/** Filas omitidas con su motivo, para corregirlas y volver a cargarlas. */
export function descargarErrores(filas) {
  const celda = (valor) => {
    const contenido = String(valor ?? '');
    return /[";\n\r]/.test(contenido)
      ? `"${contenido.replace(/"/g, '""')}"`
      : contenido;
  };
  const lineas = [
    ['Fila', ...COLUMNAS.map(([nombre]) => nombre), 'Errores'],
    ...filas.map((fila) => [
      fila.fila + 1,
      ...COLUMNAS.map(([, campo]) => fila.datos[campo] ?? ''),
      fila.errores.join(' | '),
    ]),
  ]
    .map((fila) => fila.map(celda).join(';'))
    .join('\r\n');
  descargar(
    new Blob([`\uFEFF${lineas}\r\n`], { type: 'text/csv;charset=utf-8' }),
    'xentinel-filas-con-errores.csv'
  );
}

/** Auditoría estática de enlaces locales y responsabilidades. No altera archivos ni accede a servicios externos. */
import fs from 'node:fs';
import path from 'node:path';
const archivos = fs
  .readdirSync('src', { recursive: true })
  .map((nombre) => 'src/' + nombre.replaceAll('\\', '/'))
  .filter((nombre) => /\.(jsx?|css)$/.test(nombre));
const faltantes = [];
const sinComentarios = [];
let codigoTotal = 0;
for (const archivo of archivos) {
  const codigo = fs.readFileSync(archivo, 'utf8');
  codigoTotal += codigo.split('\n').length;
  if (
    !codigo.trimStart().startsWith('/*') &&
    !codigo.trimStart().startsWith('//')
  )
    sinComentarios.push(archivo);
  if (archivo.endsWith('.css')) continue;
  for (const enlace of codigo.matchAll(
    /(?:from\s*|import\s*\(?\s*)['"]([^'"]+)['"]/g
  )) {
    if (!enlace[1].startsWith('.')) continue;
    const destino = path.resolve(path.dirname(archivo), enlace[1]);
    if (!fs.existsSync(destino)) faltantes.push({ archivo, enlace: enlace[1] });
  }
}
if (faltantes.length || sinComentarios.length) {
  console.error(JSON.stringify({ faltantes, sinComentarios }, null, 2));
  process.exitCode = 1;
} else
  console.log(
    `${archivos.length} archivos auditados; imports locales resueltos y comentarios presentes (${codigoTotal} líneas).`
  );

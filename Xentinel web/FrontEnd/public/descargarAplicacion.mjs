/** Valida la publicación Android. Los campos del manifiesto conservan el contrato del publicador existente. */
export function validarVersion(datos, direccionPagina) {
  if (!datos || datos.available !== true) return null;
  if (
    datos.packageId !== 'co.edu.sena.xentinel' ||
    !/^\d+\.\d+\.\d+$/.test(datos.version) ||
    !Number.isSafeInteger(datos.versionCode) ||
    datos.versionCode < 1 ||
    !Number.isSafeInteger(datos.sizeBytes) ||
    datos.sizeBytes < 1 ||
    !/^[a-f0-9]{64}$/.test(datos.sha256) ||
    typeof datos.url !== 'string'
  )
    throw new Error('Los datos de la versión no son válidos.');
  const direccion = new URL(datos.url, direccionPagina); // Resuelve la URL dentro del sitio de distribución.
  const pagina = new URL(direccionPagina);
  if (
    direccion.origin !== pagina.origin ||
    !['https:', 'http:'].includes(direccion.protocol) ||
    direccion.username ||
    direccion.password ||
    direccion.search ||
    direccion.hash ||
    !/^\/downloads\/xentinel-[0-9.]+-\d+\.apk$/.test(direccion.pathname)
  )
    throw new Error('El instalador debe proceder de este sitio.');
  return { ...datos, url: direccion.href };
}
/** Muestra disponibilidad real. Nunca fabrica un enlace si la publicación está marcada como no disponible. */
export async function mostrarDescarga(
  documento,
  obtenerArchivo,
  direccionPagina
) {
  const estado = documento.getElementById('estado-descarga');
  try {
    const respuesta = await obtenerArchivo(
      new URL('./app-release.json', direccionPagina),
      { cache: 'no-store' }
    );
    if (!respuesta.ok) throw new Error('No se pudo consultar la publicación.');
    const version = validarVersion(await respuesta.json(), direccionPagina);
    if (!version) {
      estado.textContent =
        'Estamos preparando el instalador actualizado. Por ahora puedes seguir usando el Dashboard Web.';
      return;
    }
    const enlace = documento.getElementById('enlace-descarga');
    enlace.href = version.url;
    enlace.download = `xentinel-${version.version}.apk`;
    enlace.hidden = false;
    estado.textContent = 'Tu versión de Xentinel está lista para descargar.';
    const etiquetaVersion = documento.getElementById('version');
    etiquetaVersion.textContent = `Versión ${version.version} · ${(version.sizeBytes / 1048576).toFixed(1)} MB · Android`;
    etiquetaVersion.hidden = false;
    documento.getElementById('huella').textContent = version.sha256;
    documento.getElementById('detalles-archivo').hidden = false;
  } catch {
    estado.textContent =
      'No pudimos comprobar el instalador. Intenta actualizar esta página en unos momentos.';
  }
}
if (typeof document !== 'undefined')
  void mostrarDescarga(document, fetch, window.location.href);

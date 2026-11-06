export function validateRelease(data, pageUrl) {
  if (!data || data.available !== true) return null;
  if (data.packageId !== 'co.edu.sena.xentinel' || !/^\d+\.\d+\.\d+$/.test(data.version) ||
      !Number.isSafeInteger(data.versionCode) || data.versionCode < 1 ||
      !Number.isSafeInteger(data.sizeBytes) || data.sizeBytes < 1 ||
      !/^[a-f0-9]{64}$/.test(data.sha256) || typeof data.url !== 'string') {
    throw new Error('Invalid release metadata');
  }
  const url = new URL(data.url, pageUrl);
  const page = new URL(pageUrl);
  if (url.origin !== page.origin || !['https:', 'http:'].includes(url.protocol) ||
      url.username || url.password || url.search || url.hash ||
      !/^\/downloads\/xentinel-[0-9.]+-\d+\.apk$/.test(url.pathname)) {
    throw new Error('Installer must come from this site');
  }
  return {...data, url: url.href};
}

export async function showDownload(document, fetchFile, pageUrl) {
  const status = document.getElementById('status');
  try {
    const response = await fetchFile(new URL('./app-release.json', pageUrl), {cache: 'no-store'});
    if (!response.ok) throw new Error('Release manifest unavailable');
    const release = validateRelease(await response.json(), pageUrl);
    if (!release) {
      status.textContent = 'Estamos preparando el instalador actualizado. Por ahora puedes seguir usando el Dashboard Web.';
      return;
    }
    const link = document.getElementById('download');
    link.href = release.url;
    link.download = `xentinel-${release.version}.apk`;
    link.hidden = false;
    status.textContent = 'Tu versión de Xentinel está lista para descargar.';
    const version = document.getElementById('version');
    version.textContent = `Versión ${release.version} · ${(release.sizeBytes / 1048576).toFixed(1)} MB · Android`;
    version.hidden = false;
    document.getElementById('checksum').textContent = release.sha256;
    document.getElementById('file-details').hidden = false;
  } catch {
    status.textContent = 'No pudimos comprobar el instalador. Intenta actualizar esta página en unos momentos.';
  }
}

if (typeof document !== 'undefined') {
  void showDownload(document, fetch, window.location.href);
}

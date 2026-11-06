// Cliente compartido Web / JS móvil. El token se obtiene de memoria o almacenamiento seguro del dispositivo.
export function createXentinelClient({ baseUrl, getToken, fetchImpl = globalThis.fetch }) {
  const root = baseUrl.replace(/\/$/, '');
  async function request(path, { method = 'GET', body, signal } = {}) {
    const token = await getToken();
    const response = await fetchImpl(`${root}/api/v1${path}`, {
      method,
      signal,
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 204) return null;
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.error?.message || 'Error de API');
      error.status = response.status;
      error.code = result.error?.code;
      throw error;
    }
    return result;
  }
  // Una conexión; el llamador conserva el cursor y reintenta tras 2 s si se corta.
  // Web: fetch streaming. Móvil nativo: usar un cliente SSE con cabecera Authorization.
  async function events({ after = '0', signal, onChange, onCheckpoint = () => {} }) {
    const token = await getToken();
    const response = await fetchImpl(`${root}/api/v1/eventos?after=${encodeURIComponent(after)}`, {
      signal,
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
    });
    if (!response.ok) throw new Error(`No se pudo abrir SSE (${response.status})`);
    if (!response.body?.getReader)
      throw new Error('Este runtime requiere un cliente SSE nativo con cabeceras Bearer');
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          let event = '',
            data = '',
            cursor;
          for (const line of frame.split('\n')) {
            if (line.startsWith('event: ')) event = line.slice(7);
            if (line.startsWith('data: ')) data = line.slice(6);
            if (line.startsWith('id: ')) cursor = line.slice(4);
          }
          if (event === 'auth-expired') throw new Error('La sesión venció; inicia sesión de nuevo');
          if (event === 'change') await onChange(JSON.parse(data));
          // Confirmar cursor DESPUÉS de aplicar el cambio: al reconectar nunca se omite un evento pendiente.
          if (cursor) await onCheckpoint(cursor);
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  return {
    request,
    events,
    login: (documento, contrasena) =>
      request('/auth/login', { method: 'POST', body: { documento, contrasena } }),
    forgotPassword: (correo) => request('/auth/olvide-contrasena', { method: 'POST', body: { correo } }),
    activeAlerts: () => request('/alertas/activas'),
  };
}

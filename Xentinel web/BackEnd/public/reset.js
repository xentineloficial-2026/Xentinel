const statusNode = document.querySelector('#status'),
  form = document.querySelector('#reset-form');
const fragment = new URLSearchParams(location.hash.slice(1));
const credentials = { correo: fragment.get('correo'), token: fragment.get('token') };
history.replaceState(null, '', location.pathname);
async function post(path, body) {
  const response = await fetch(`/api/v1/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'No se pudo completar la solicitud');
  return data.data;
}
async function validate() {
  try {
    if (!credentials.correo || !credentials.token)
      throw new Error('Abre el enlace completo que recibiste por correo.');
    await post('validar-recuperacion', credentials);
    statusNode.textContent = 'Enlace válido. Escribe tu nueva contraseña.';
    form.hidden = false;
  } catch (error) {
    statusNode.textContent = error.message;
  }
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = document.querySelector('#password').value;
  if (password !== document.querySelector('#confirm').value) {
    statusNode.textContent = 'Las contraseñas no coinciden.';
    return;
  }
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const result = await post('restablecer-contrasena', { ...credentials, contrasena: password });
    statusNode.textContent = result.message;
    form.reset();
    form.hidden = true;
    credentials.token = null;
  } catch (error) {
    statusNode.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
validate();

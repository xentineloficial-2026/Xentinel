const statusNode = document.querySelector('#status'),
  form = document.querySelector('#reset-form'),
  emailInput = document.querySelector('#email'),
  codeInput = document.querySelector('#code');
emailInput.value = new URLSearchParams(location.hash.slice(1)).get('correo') || '';
history.replaceState(null, '', location.pathname);
codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6);
});
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
    const result = await post('restablecer-contrasena', {
      correo: emailInput.value.trim(),
      codigo: codeInput.value,
      contrasena: password,
    });
    statusNode.textContent = result.message;
    form.reset();
    form.hidden = true;
  } catch (error) {
    statusNode.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

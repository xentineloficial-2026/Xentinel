/** Conmutador de la descarga: comparte almacenamiento y atributo de tema con React. */
const botonTema = document.getElementById('tema');
function actualizarEtiqueta() {
  botonTema.textContent =
    document.documentElement.dataset.theme === 'dark'
      ? 'Modo claro'
      : 'Modo oscuro';
}
botonTema.addEventListener('click', () => {
  const tema =
    document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = tema;
  document.documentElement.style.colorScheme = tema;
  try {
    localStorage.setItem('xentinel-theme', tema);
  } catch {
    /* La preferencia funciona en memoria si el almacenamiento no está disponible. */
  }
  actualizarEtiqueta();
});
actualizarEtiqueta();

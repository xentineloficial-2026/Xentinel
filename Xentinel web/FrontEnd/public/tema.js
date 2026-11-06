/** Aplica el tema antes del primer pintado y conserva la preferencia previa de Xentinel. */
(function () {
  let tema;
  try {
    tema = localStorage.getItem('xentinel-theme');
  } catch {
    /* El modo privado permite continuar con el tema predeterminado. */
  }
  // El tema oscuro es la identidad principal; el claro queda a un clic en el conmutador.
  if (tema !== 'light' && tema !== 'dark') tema = 'dark';
  document.documentElement.dataset.theme = tema;
  document.documentElement.style.colorScheme = tema;
})();

/** Conserva y sincroniza la preferencia claro/oscuro entre páginas. */
import { useEffect as useEfecto, useState as useEstado } from 'react';
import { ContextoTema } from './tema.js';
function ProveedorTema({ children: contenido }) {
  /* tema, cambiarTema: estado de la vista y función para actualizarlo. */
  const [tema, cambiarTema] = useEstado(
    () => document.documentElement.dataset.theme || 'light'
  );
  useEfecto(() => {
    document.documentElement.dataset.theme = tema;
    document.documentElement.style.colorScheme = tema;
    try {
      localStorage.setItem('xentinel-theme', tema);
    } catch {
      /* El tema sigue funcionando en memoria. */
    }
  }, [tema]);
  useEfecto(() => {
    /* sincronizar: operación local que atiende el evento o transforma la información. */
    const sincronizar = (evento) => {
      if (
        evento.key === 'xentinel-theme' &&
        ['light', 'dark'].includes(evento.newValue)
      )
        cambiarTema(evento.newValue);
    };
    window.addEventListener('storage', sincronizar);
    return () => window.removeEventListener('storage', sincronizar);
  }, []);
  return (
    <ContextoTema.Provider
      value={{
        tema,
        alternarTema: () =>
          cambiarTema((valor) => (valor === 'dark' ? 'light' : 'dark')),
      }}
    >
      {contenido}
    </ContextoTema.Provider>
  );
}
export { ProveedorTema };

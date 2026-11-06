/** Conmutador accesible: el nuevo tema se revela en círculo desde el punto donde se hizo clic. */
import { Moon as Luna, Sun as Sol } from 'lucide-react';
import { useTema } from '../contextos/tema.js';
import { alternarConRevelado } from '../utilidades/revelarTema.js';

function ConmutadorTema() {
  /* tema, alternarTema: valor de trabajo utilizado en esta operación. */
  const { tema, alternarTema } = useTema();
  /* etiqueta: valor de trabajo utilizado en esta operación. */
  const etiqueta =
    tema === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro';
  return (
    <button
      className="xn-tema-conmutador"
      type="button"
      onClick={(evento) => alternarConRevelado(evento, alternarTema)}
      aria-label={etiqueta}
      title={etiqueta}
      aria-pressed={tema === 'dark'}
    >
      {tema === 'dark' ? <Sol size={19} /> : <Luna size={19} />}
    </button>
  );
}
export { ConmutadorTema };

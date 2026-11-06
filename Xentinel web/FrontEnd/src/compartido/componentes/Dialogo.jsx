/** Diálogo nativo modal: foco atrapado, Escape, fondo inerte y restauración del foco al cerrar. */
import { useEffect as useEfecto, useRef as useReferencia } from 'react';
import { X as Cerrar } from 'lucide-react';
function Dialogo({ titulo, children: contenido, alCerrar, ocupado = false }) {
  /* referencia: referencia estable entre renderizados, sin disparar una actualización visual. */
  const referencia = useReferencia(null);
  useEfecto(() => {
    /* dialogo: valor de trabajo utilizado en esta operación. */
    const dialogo = referencia.current;
    /* anterior: valor de trabajo utilizado en esta operación. */
    const anterior = document.activeElement;
    dialogo.showModal();
    dialogo.querySelector('[data-initial-focus]')?.focus();
    return () => {
      dialogo.close();
      anterior?.focus();
    };
  }, []);
  return (
    <dialog
      ref={referencia}
      className="xn-dialogo"
      aria-labelledby="dialog-title"
      onCancel={(evento) => {
        evento.preventDefault();
        if (!ocupado) alCerrar();
      }}
    >
      <div className="xn-dialogo-titulo">
        <h2 id="dialog-title">{titulo}</h2>
        <button
          className="xn-icono-boton"
          aria-label="Cerrar diálogo"
          onClick={alCerrar}
          disabled={ocupado}
        >
          <Cerrar size={20} />
        </button>
      </div>
      {contenido}
    </dialog>
  );
}
export { Dialogo };

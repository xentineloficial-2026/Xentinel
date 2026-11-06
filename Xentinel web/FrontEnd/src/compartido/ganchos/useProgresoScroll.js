/** Expone en la variable CSS --p cuánto se ha recorrido una sección (0 a 1) para animarla con el scroll. */
import { useEffect as useEfecto, useRef as useReferencia } from 'react';

export function useProgresoScroll(alCambiar) {
  const referencia = useReferencia(null);
  const aviso = useReferencia(alCambiar);
  useEfecto(() => {
    aviso.current = alCambiar;
  });
  useEfecto(() => {
    const elemento = referencia.current;
    if (!elemento) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      elemento.style.setProperty('--p', '1');
      aviso.current?.(1, elemento);
      return;
    }
    let cuadro = 0;
    const medir = () => {
      cuadro = 0;
      const caja = elemento.getBoundingClientRect();
      const alto = window.innerHeight;
      /* Una sección fijada se recorre mientras dura; una normal, al cruzar la pantalla. */
      const recorrido = caja.height - alto;
      const valor =
        recorrido > alto * 0.2
          ? -caja.top / recorrido
          : (alto - caja.top) / (alto + caja.height);
      const progreso = Math.min(1, Math.max(0, valor));
      elemento.style.setProperty('--p', progreso.toFixed(4));
      aviso.current?.(progreso, elemento);
    };
    const pedir = () => {
      if (!cuadro) cuadro = requestAnimationFrame(medir);
    };
    window.addEventListener('scroll', pedir, { passive: true });
    window.addEventListener('resize', pedir);
    medir();
    return () => {
      cancelAnimationFrame(cuadro);
      window.removeEventListener('scroll', pedir);
      window.removeEventListener('resize', pedir);
    };
  }, []);
  return referencia;
}

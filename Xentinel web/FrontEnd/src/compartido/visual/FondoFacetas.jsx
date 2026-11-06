/** Monta las facetas 3D de forma diferida; sin WebGL queda el degradado del CSS y todo sigue funcionando. */
import { useEffect as useEfecto, useRef as useReferencia } from 'react';
import { useTema } from '../contextos/tema.js';

export function FondoFacetas({ estatico = false, className = '' }) {
  const contenedor = useReferencia(null);
  const escena = useReferencia(null);
  const { tema } = useTema();
  const temaActual = useReferencia(tema);
  useEfecto(() => {
    temaActual.current = tema;
    escena.current?.fijarTema(tema);
  }, [tema]);
  useEfecto(() => {
    let descartado = false;
    const quieto =
      estatico || matchMedia('(prefers-reduced-motion: reduce)').matches;
    import('./facetas3d.js')
      .then(({ crearFondoFacetas }) => {
        if (descartado || !contenedor.current) return;
        escena.current = crearFondoFacetas(contenedor.current, {
          estatico: quieto,
          tema: temaActual.current,
        });
      })
      .catch(() => {});
    return () => {
      descartado = true;
      escena.current?.liberar();
      escena.current = null;
    };
  }, [estatico]);
  return (
    <div
      ref={contenedor}
      className={`xn-facetas ${className}`}
      aria-hidden="true"
    />
  );
}

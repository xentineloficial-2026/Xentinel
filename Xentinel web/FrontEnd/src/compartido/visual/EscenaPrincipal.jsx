/** Lienzo del escudo 3D. Sin WebGL muestra el logo vectorial y la portada se mantiene completa. */
import {
  useEffect as useEfecto,
  useImperativeHandle as useManejador,
  useRef as useReferencia,
  useState as useEstado,
} from 'react';
import { EscudoXentinel } from '../identidad/Marca.jsx';

export function EscenaPrincipal({ ref }) {
  const contenedor = useReferencia(null);
  const escena = useReferencia(null);
  const ultimo = useReferencia(0);
  const [sinWebgl, cambiarSinWebgl] = useEstado(false);
  useManejador(
    ref,
    () => ({
      fijarProgreso(valor) {
        ultimo.current = valor;
        escena.current?.fijarProgreso(valor);
      },
    }),
    []
  );
  useEfecto(() => {
    let descartado = false;
    import('./escudo3d.js')
      .then(({ crearEscenaEscudo }) => {
        if (descartado || !contenedor.current) return;
        try {
          escena.current = crearEscenaEscudo(contenedor.current, {
            movimientoReducido: matchMedia('(prefers-reduced-motion: reduce)')
              .matches,
          });
          escena.current.fijarProgreso(ultimo.current);
        } catch {
          cambiarSinWebgl(true);
        }
      })
      .catch(() => cambiarSinWebgl(true));
    return () => {
      descartado = true;
      escena.current?.liberar();
      escena.current = null;
    };
  }, []);
  return (
    <div ref={contenedor} className="xn-cine-lienzo" aria-hidden="true">
      {sinWebgl && <EscudoXentinel className="xn-cine-respaldo" />}
    </div>
  );
}

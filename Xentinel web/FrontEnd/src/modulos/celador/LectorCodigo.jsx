/** Lector activado por la persona operadora. Sigue leyendo entre una persona y la siguiente y
 * detiene la cámara al salir. Una lectura repetida del mismo carnet se ignora unos segundos. */
import {
  useEffect as useEfecto,
  useId as useIdentificador,
  useRef as useReferencia,
  useState as useEstado,
} from 'react';
import { Camera as Camara, ScanLine as Escaneo } from 'lucide-react';
import { leerCodigoAcceso } from '../../compartido/utilidades/codigoQr.js';
import { tocarTono } from '../../compartido/utilidades/tonos.js';
/* Pausa entre lecturas y tiempo en que el mismo código no se vuelve a enviar. */
const PAUSA_MS = 2500;
const REPETIDO_MS = 6000;
export function LectorCodigo({ alLeer }) {
  /* identificador: valor de trabajo utilizado en esta operación. */
  const identificador = useIdentificador().replaceAll(':', '');
  /* referenciaLector: referencia estable entre renderizados, sin disparar una actualización visual. */
  const referenciaLector = useReferencia(null);
  /* referenciaMontado: referencia estable entre renderizados, sin disparar una actualización visual. */
  const referenciaMontado = useReferencia(true);
  /* estado, cambiarEstado: estado de la vista y función para actualizarlo. */
  const [estado, cambiarEstado] = useEstado('inactivo');
  /* error, cambiarError: estado de la vista y función para actualizarlo. */
  const [error, cambiarError] = useEstado('');
  useEfecto(() => {
    referenciaMontado.current = true;
    return () => {
      referenciaMontado.current = false;
      /* lector: valor de trabajo utilizado en esta operación. */
      const lector = referenciaLector.current;
      referenciaLector.current = null;
      if (lector?.isScanning)
        lector
          .stop()
          .then(() => lector.clear())
          .catch(() => {});
    };
  }, []);
  /* detener: operación local que atiende el evento o transforma la información. */
  const detener = async () => {
    /* lector: valor de trabajo utilizado en esta operación. */
    const lector = referenciaLector.current;
    referenciaLector.current = null;
    try {
      if (lector?.isScanning) await lector.stop();
      lector?.clear();
    } catch {
      /* La cámara puede haberse liberado al cambiar de pestaña. */
    }
    if (referenciaMontado.current) cambiarEstado('inactivo');
  };
  /* iniciar: operación local que atiende el evento o transforma la información. */
  const iniciar = async () => {
    if (estado !== 'inactivo') return;
    cambiarEstado('preparando');
    cambiarError('');
    /* lector: valor de trabajo utilizado en esta operación. */
    let lector;
    try {
      /* Html5Qrcode, LectorQr: valor de trabajo utilizado en esta operación. */
      const { Html5Qrcode: LectorQr } = await import('html5-qrcode');
      if (!referenciaMontado.current) return;
      lector = new LectorQr(identificador, {
        verbose: false,
      });
      referenciaLector.current = lector;
      /* ultimo: código y hora de la última lectura aceptada o rechazada. */
      const ultimo = { texto: '', hora: 0 };
      await lector.start(
        {
          facingMode: 'environment',
        },
        {
          fps: 8,
          qrbox: {
            width: 220,
            height: 220,
          },
        },
        (texto) => {
          const ahora = Date.now();
          if (
            ahora - ultimo.hora < PAUSA_MS ||
            (texto === ultimo.texto && ahora - ultimo.hora < REPETIDO_MS)
          )
            return;
          ultimo.texto = texto;
          ultimo.hora = ahora;
          try {
            const codigo = leerCodigoAcceso(texto);
            cambiarError('');
            alLeer(codigo);
          } catch (motivo) {
            tocarTono('error');
            cambiarError(motivo.message);
          }
        },
        () => {}
      );
      if (!referenciaMontado.current) {
        await lector.stop();
        lector.clear();
        return;
      }
      cambiarEstado('leyendo');
    } catch {
      if (referenciaMontado.current) {
        cambiarError(
          'No pudimos abrir la cámara. Revisa el permiso o utiliza el ingreso manual.'
        );
        cambiarEstado('inactivo');
      }
    }
  };
  return (
    <section className="xn-lector-qr">
      <div>
        <Escaneo size={22} />
        <h2>Escanear carnet QR</h2>
      </div>
      <p>
        Activa la cámara y apunta al carnet QR de la app o de la web. El
        movimiento elegido arriba se registra al leerlo.
      </p>
      <div
        id={identificador}
        className={`xn-visor-qr ${estado === 'inactivo' ? 'sin-camara' : ''}`}
      />
      {error && (
        <p className="xn-acceso-error" role="alert">
          {error}
        </p>
      )}
      <div className="xn-acciones-lector">
        {estado === 'inactivo' ? (
          <button
            type="button"
            className="xn-boton xn-boton--secundario"
            onClick={iniciar}
          >
            <Camara size={17} />
            Activar cámara
          </button>
        ) : (
          <button
            type="button"
            className="xn-boton xn-boton--secundario"
            onClick={detener}
            disabled={estado === 'preparando'}
          >
            {estado === 'preparando' ? 'Abriendo cámara…' : 'Detener cámara'}
          </button>
        )}
      </div>
    </section>
  );
}

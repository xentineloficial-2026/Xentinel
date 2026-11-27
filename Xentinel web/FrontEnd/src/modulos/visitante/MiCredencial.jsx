/** Carnet digital en la web: el mismo código QR firmado y rotativo de la app. El servidor
 * verifica su firma y su vigencia al registrar la entrada o la salida. */
import {
  useEffect as useEfecto,
  useRef as useReferencia,
  useState as useEstado,
} from 'react';
import { QRCodeSVG as CodigoQr } from 'qrcode.react';
import { RefreshCw as Renovar, ShieldCheck as Escudo } from 'lucide-react';
import { useAutenticacion } from '../../compartido/contextos/autenticacion.js';
import { useRecurso } from '../../compartido/ganchos/useRecurso.js';
import {
  pasoDe,
  prepararFirma,
} from '../../compartido/utilidades/carnetFirmado.js';
import { crearContenidoQr } from '../../compartido/utilidades/codigoQr.js';
import '../../compartido/estilos/acceso.css';

/** Código vigente y segundos que le quedan; se recalcula cada segundo. */
function useCarnetFirmado(credencial) {
  const [carnet, cambiarCarnet] = useEstado(null);
  const [falla, cambiarFalla] = useEstado(null);
  const desfase = useReferencia(0);
  useEfecto(() => {
    if (!credencial) return undefined;
    let vigente = true;
    let reloj;
    // La hora del servidor manda: corrige un reloj local adelantado o atrasado.
    desfase.current = credencial.servidor_ms
      ? credencial.servidor_ms - Date.now()
      : 0;
    const segundosPaso = credencial.paso_segundos || 15;
    prepararFirma(credencial.clave)
      .then((firmar) => {
        let pasoMostrado = null;
        const actualizar = async () => {
          const ahora = Date.now() + desfase.current;
          const paso = pasoDe(ahora, segundosPaso);
          const restante = Math.ceil(
            ((paso + 1) * segundosPaso * 1000 - ahora) / 1000
          );
          if (paso !== pasoMostrado) {
            pasoMostrado = paso;
            const codigo = await firmar(credencial.id_usuarios, paso);
            if (vigente) cambiarCarnet({ codigo, restante, segundosPaso });
          } else if (vigente)
            cambiarCarnet((actual) => actual && { ...actual, restante });
        };
        actualizar();
        reloj = setInterval(actualizar, 1000);
      })
      .catch((motivo) => vigente && cambiarFalla(motivo));
    return () => {
      vigente = false;
      clearInterval(reloj);
    };
  }, [credencial]);
  return { carnet, falla };
}

export function MiCredencial() {
  const { usuario } = useAutenticacion();
  const recurso = useRecurso('/auth/credencial-qr');
  const { carnet, falla } = useCarnetFirmado(recurso.datos);
  const sinFirma = recurso.estado === 'error' || falla;
  const contenido =
    carnet?.codigo ?? (sinFirma ? crearContenidoQr(usuario.id_usuarios) : null);
  return (
    <>
      <div className="xn-panel-titulo">
        <div>
          <h1>Tu carnet QR</h1>
          <p>Muéstralo en el punto de control para registrar tu entrada.</p>
        </div>
      </div>
      <div className="xn-credencial-distribucion">
        <article className="xn-credencial">
          <div className="xn-credencial-cabecera">
            <span>Xentinel</span>
            <Escudo size={22} aria-hidden="true" />
          </div>
          <div className="xn-qr-superficie">
            {contenido ? (
              <CodigoQr
                value={contenido}
                size={232}
                level="Q"
                marginSize={4}
                title={`Carnet Xentinel de ${usuario.nombres_completos}`}
              />
            ) : (
              <p role="status" className="xn-qr-cargando">
                Preparando tu carnet…
              </p>
            )}
          </div>
          <h2>{usuario.nombres_completos}</h2>
          <p>
            {usuario.nombre_rol || 'Comunidad Xentinel'} ·{' '}
            {usuario.numero_documento}
          </p>
          {carnet ? (
            <div
              className="xn-carnet-renovacion"
              style={{
                '--avance': `${(carnet.restante / carnet.segundosPaso) * 100}%`,
              }}
            >
              <Renovar size={15} aria-hidden="true" />
              <span aria-live="off">Se renueva en {carnet.restante} s</span>
            </div>
          ) : (
            sinFirma && (
              <span className="xn-estado es-neutro">
                Identificador sin firma
              </span>
            )
          )}
        </article>
        <section className="xn-trabajo-tarjeta xn-credencial-ayuda">
          <h2>Cómo usarlo</h2>
          <p>
            Abre esta página en tu celular y acércalo al lector. El código
            cambia cada 15 segundos: una captura de pantalla no sirve, y solo el
            servidor de Xentinel puede validarlo.
          </p>
          <p>
            Tu carnet no contiene tu contraseña ni datos personales. Si cierras
            sesión en todos tus equipos, el carnet anterior deja de funcionar.
          </p>
          {sinFirma && (
            <p className="xn-ayuda">
              No pudimos preparar el carnet firmado
              {recurso.estado === 'error' ? ' (sin conexión)' : ''}. Se muestra
              tu identificador: el personal confirmará tu identidad antes de
              registrarte.
            </p>
          )}
          {recurso.estado === 'error' && (
            <button
              className="xn-boton xn-boton--secundario"
              onClick={recurso.actualizar}
            >
              Reintentar
            </button>
          )}
        </section>
      </div>
    </>
  );
}

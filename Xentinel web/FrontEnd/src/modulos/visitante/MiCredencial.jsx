/** Identificación personal QR. El código solo contiene un ID y se valida al registrar el movimiento. */
import { useRef as useReferencia, useState as useEstado } from 'react';
import { QRCodeSVG as CodigoQr } from 'qrcode.react';
import { Download as Descargar, ShieldCheck as Escudo } from 'lucide-react';
import { useAutenticacion } from '../../compartido/contextos/autenticacion.js';
import { crearContenidoQr } from '../../compartido/utilidades/codigoQr.js';
export function MiCredencial() {
  /* usuario: valor de trabajo utilizado en esta operación. */
  const { usuario } = useAutenticacion();
  /* referenciaCodigo: referencia estable entre renderizados, sin disparar una actualización visual. */
  const referenciaCodigo = useReferencia(null);
  /* mensaje, cambiarMensaje: estado de la vista y función para actualizarlo. */
  const [mensaje, cambiarMensaje] = useEstado('');
  /* descargar: operación local que atiende el evento o transforma la información. */
  const descargar = () => {
    /* contenido: valor de trabajo utilizado en esta operación. */
    const contenido = new XMLSerializer().serializeToString(
      referenciaCodigo.current.querySelector('svg')
    );
    /* direccion: valor de trabajo utilizado en esta operación. */
    const direccion = URL.createObjectURL(
      new Blob([contenido], {
        type: 'image/svg+xml',
      })
    );
    /* enlace: valor de trabajo utilizado en esta operación. */
    const enlace = document.createElement('a');
    enlace.href = direccion;
    enlace.download = 'identificador-xentinel.svg';
    enlace.click();
    setTimeout(() => URL.revokeObjectURL(direccion), 1000);
    cambiarMensaje('Tu código QR se descargó correctamente.');
  };
  return (
    <>
      <div className="xn-panel-titulo">
        <div>
          <h1>Tu identificación QR</h1>
          <p>Un código sencillo para encontrarte dentro de tu comunidad.</p>
        </div>
      </div>
      <div className="xn-credencial-distribucion">
        <article className="xn-credencial">
          <div className="xn-credencial-cabecera">
            <span>Xentinel</span>
            <Escudo size={22} />
          </div>
          <div className="xn-qr-superficie" ref={referenciaCodigo}>
            <CodigoQr
              value={crearContenidoQr(usuario.id_usuarios)}
              size={220}
              level="M"
              marginSize={4}
              title={`Identificador Xentinel de ${usuario.nombres_completos}`}
            />
          </div>
          <h2>{usuario.nombres_completos}</h2>
          <p>
            {usuario.nombre_rol || 'Comunidad Xentinel'} · ID{' '}
            {usuario.id_usuarios}
          </p>
          <span className="xn-estado es-neutro">Identificador personal</span>
        </article>
        <section className="xn-trabajo-tarjeta xn-credencial-ayuda">
          <h2>Muéstralo en el punto de acceso.</h2>
          <p>
            El personal comprobará tu identidad y registrará tu entrada o
            salida. El código facilita la búsqueda de tu usuario; conserva tu
            documento a mano.
          </p>
          <p>Tu QR no contiene tu contraseña ni tu sesión.</p>
          <button className="xn-boton" onClick={descargar}>
            <Descargar size={17} />
            Descargar mi QR
          </button>
          {mensaje && <p role="status">{mensaje}</p>}
        </section>
      </div>
    </>
  );
}

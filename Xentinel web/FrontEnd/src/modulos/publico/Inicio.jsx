/** Portada por capítulos, a escala de pantalla completa: escudo 3D, carnet, panel, funciones, emergencia y app. */
import {
  useCallback as useMemorizada,
  useRef as useReferencia,
  useState as useEstado,
} from 'react';
import {
  ArrowRight as FlechaDerecha,
  ArrowUpRight as FlechaDiagonal,
  Clock as Reloj,
  FileSpreadsheet as Reporte,
  Radio as Vivo,
  Moon as Luna,
  ShieldCheck as Escudo,
  Sun as Sol,
  TriangleAlert as Triangulo,
  UsersRound as Personas,
} from 'lucide-react';
import { Link as Enlace } from 'react-router-dom';
import { useAutenticacion } from '../../compartido/contextos/autenticacion.js';
import { useTema } from '../../compartido/contextos/tema.js';
import { inicioParaUsuario } from '../../configuracion/navegacion.js';
import { EscenaPrincipal } from '../../compartido/visual/EscenaPrincipal.jsx';
import { FondoFacetas } from '../../compartido/visual/FondoFacetas.jsx';
import { Perimetro } from '../../compartido/identidad/Perimetro.jsx';
import { SimboloXentinel } from '../../compartido/identidad/Marca.jsx';
import { useProgresoScroll } from '../../compartido/ganchos/useProgresoScroll.js';
import { alternarConRevelado } from '../../compartido/utilidades/revelarTema.js';
import { DemostracionSismo, Sismografo } from './SimulacroSismo.jsx';
import { VitrinaPanel, VitrinaTelefono } from './Vitrinas.jsx';
import './cine.css';

function CapituloEscudo({ usuario }) {
  const escena = useReferencia(null);
  const seccion = useProgresoScroll((progreso, elemento) => {
    escena.current?.fijarProgreso(progreso);
    elemento.dataset.inicio = progreso < 0.16 ? 'si' : 'no';
  });
  return (
    <section ref={seccion} className="xn-cine xn-oscuro" data-inicio="si">
      <div className="xn-cine-fijo">
        <div className="xn-cine-resplandor" />
        <Perimetro />
        <p className="xn-cine-marca" aria-hidden="true">
          Xentinel
        </p>
        <EscenaPrincipal ref={escena} />
        <div className="xn-cine-portada">
          <div>
            {usuario && (
              <p className="xn-welcome">
                Hola, {usuario.nombres_completos?.split(' ')[0]}. Qué bueno
                verte.
              </p>
            )}
            <h1>
              Un acceso seguro.
              <br />
              Un entorno conectado.
            </h1>
          </div>
          <div className="xn-cine-acciones">
            <Enlace className="xn-boton" to={inicioParaUsuario(usuario)}>
              {usuario ? 'Volver a mi espacio' : 'Ingresar a Xentinel'}
              <FlechaDiagonal size={18} />
            </Enlace>
            <a className="xn-texto-enlace" href="#capitulos">
              Conoce cómo funciona <FlechaDerecha size={17} />
            </a>
          </div>
        </div>
        <p className="xn-cine-paso xn-cine-paso--uno">
          Tu teléfono
          <br />
          es la llave.
        </p>
        <p className="xn-cine-paso xn-cine-paso--dos">
          Cada acceso,
          <br />
          registrado.
        </p>
      </div>
    </section>
  );
}

function CapituloCarnet() {
  const seccion = useProgresoScroll();
  return (
    <section
      ref={seccion}
      id="capitulos"
      className="xn-capitulo xn-capitulo--carnet xn-oscuro"
    >
      <Perimetro />
      <div className="xn-capitulo-texto">
        <h2>Tu carnet vive en tu bolsillo.</h2>
        <p>
          Un código que se renueva solo cada 15 segundos. Lo muestras, el
          celador lo escanea y sigues tu camino.
        </p>
      </div>
      <VitrinaTelefono />
    </section>
  );
}

function CapituloPanel() {
  const seccion = useProgresoScroll();
  return (
    <section ref={seccion} className="xn-capitulo xn-capitulo--panel xn-oscuro">
      <FondoFacetas />
      <div className="xn-capitulo-encabezado">
        <h2>Toda tu sede, de un vistazo.</h2>
        <p>Quién entra, quién sale y cómo va la asistencia, en tiempo real.</p>
      </div>
      <div className="xn-vitrina-escala">
        <VitrinaPanel />
      </div>
    </section>
  );
}

function CapituloFunciones() {
  const { tema, alternarTema } = useTema();
  return (
    <section className="xn-funciones">
      <h2>Una plataforma. Todo tu entorno.</h2>
      <div className="xn-bento">
        <article className="xn-bento-celda xn-bento-celda--ancha">
          <Reloj size={26} />
          <h3>La asistencia se toma sola.</h3>
          <p>
            Cada entrada de un aprendiz marca su asistencia y calcula si llegó a
            tiempo, según la jornada de su ficha.
          </p>
          <div className="xn-bento-estados" aria-hidden="true">
            <span className="si">Presente · 06:58</span>
            <span className="tarde">Retrasado · 07:12</span>
            <span>Sin registro</span>
          </div>
        </article>
        <article className="xn-bento-celda">
          <Personas size={26} />
          <h3>Cada rol, su espacio.</h3>
          <div className="xn-bento-roles" aria-hidden="true">
            {['Administrador', 'Instructor', 'Celador', 'Aprendiz'].map(
              (rol) => (
                <span key={rol}>{rol}</span>
              )
            )}
          </div>
        </article>
        <article className="xn-bento-celda">
          <Vivo size={26} />
          <h3>En tiempo real.</h3>
          <p>El panel se actualiza solo con cada movimiento.</p>
          <span className="xn-bento-pulso" aria-hidden="true" />
        </article>
        <article className="xn-bento-celda">
          <Reporte size={26} />
          <h3>Reportes en CSV y Excel.</h3>
          <p>Accesos y horarios listos para compartir.</p>
        </article>
        <article className="xn-bento-celda xn-bento-celda--tema">
          {tema === 'dark' ? <Luna size={26} /> : <Sol size={26} />}
          <h3>Claro u oscuro. Tú eliges.</h3>
          <button
            type="button"
            className="xn-boton xn-boton--secundario"
            onClick={(evento) => alternarConRevelado(evento, alternarTema)}
          >
            Cambiar tema
          </button>
        </article>
      </div>
    </section>
  );
}

function CapituloSismo() {
  const intensidad = useReferencia(0);
  const seccion = useProgresoScroll((progreso) => {
    intensidad.current = Math.min(1, progreso / 0.5);
  });
  const [demostracion, cambiarDemostracion] = useEstado(false);
  const cerrar = useMemorizada(() => cambiarDemostracion(false), []);
  return (
    <section ref={seccion} className="xn-sismo xn-oscuro">
      <div className="xn-sismo-fijo">
        <p className="xn-sismo-calma">Todo va normal.</p>
        <Sismografo intensidad={intensidad} />
        <div className="xn-sismo-rojo">
          <div className="xn-sismo-contenido">
            <Triangulo size={56} strokeWidth={2.2} />
            <h2>Cuando todo tiembla, la pantalla cambia.</h2>
            <p>
              Xentinel interrumpe lo que estés haciendo y deja una sola tarea:
              ponerte a salvo. Letra enorme, botones grandes y ayuda con tu
              ubicación a un toque.
            </p>
            <button
              type="button"
              className="xn-sismo-boton"
              onClick={() => cambiarDemostracion(true)}
            >
              Ver la alerta a pantalla completa
            </button>
          </div>
        </div>
      </div>
      {demostracion && <DemostracionSismo alCerrar={cerrar} />}
    </section>
  );
}

export function Bienvenida() {
  /* usuario: valor de trabajo utilizado en esta operación. */
  const { usuario } = useAutenticacion();
  return (
    <>
      <CapituloEscudo usuario={usuario} />
      <CapituloCarnet />
      <CapituloPanel />
      <CapituloFunciones />
      <CapituloSismo />
      <section className="xn-cierre xn-oscuro">
        <SimboloXentinel />
        <h2>Tu próximo acceso, en tu bolsillo.</h2>
        <p>
          <Escudo size={18} />
          Para instituciones y empresas que cuidan a su gente.
        </p>
        <a className="xn-boton" href="/Descarga.html">
          Descarga nuestra app <FlechaDiagonal size={18} />
        </a>
      </section>
    </>
  );
}

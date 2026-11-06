/** Línea sísmica de la portada y demostración a pantalla completa de la interrupción de emergencia. */
import {
  useEffect as useEfecto,
  useRef as useReferencia,
  useState as useEstado,
} from 'react';
import { LifeBuoy as Ayuda, TriangleAlert as Triangulo } from 'lucide-react';
import '../../compartido/estilos/panel.css';

/** Traza una señal que crece con la intensidad; intensidad es una referencia actualizada por el scroll. */
export function Sismografo({ intensidad }) {
  const lienzo = useReferencia(null);
  useEfecto(() => {
    const elemento = lienzo.current;
    const contexto = elemento.getContext('2d');
    const reducido = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let cuadro = 0;
    let visible = false;
    let fase = 0;
    const dibujar = () => {
      cuadro = 0;
      const escala = Math.min(window.devicePixelRatio || 1, 2);
      const ancho = elemento.clientWidth;
      const alto = elemento.clientHeight;
      if (elemento.width !== ancho * escala) elemento.width = ancho * escala;
      if (elemento.height !== alto * escala) elemento.height = alto * escala;
      contexto.setTransform(escala, 0, 0, escala, 0, 0);
      contexto.clearRect(0, 0, ancho, alto);
      contexto.strokeStyle = '#ccd0cf';
      contexto.lineWidth = 1.5;
      contexto.beginPath();
      const fuerza = intensidad.current;
      fase += 0.045 + fuerza * 0.12;
      for (let x = 0; x <= ancho; x += 2) {
        const avance = x / ancho;
        /* La onda llega desde la derecha: la izquierda sigue casi en calma. */
        const llegada = Math.min(1, Math.max(0, (avance - 0.32 + fuerza) * 2.2));
        const ruido =
          Math.sin(x * 0.11 + fase * 3) * 0.5 +
          Math.sin(x * 0.27 - fase * 4.3) * 0.3 +
          Math.sin(x * 0.61 + fase * 7) * 0.2;
        const y =
          alto / 2 +
          ruido * (2 + llegada * fuerza * alto * 0.46) +
          Math.sin(x * 0.02 + fase) * 1.5;
        if (x === 0) contexto.moveTo(x, y);
        else contexto.lineTo(x, y);
      }
      contexto.stroke();
      if (visible && !reducido && !document.hidden)
        cuadro = requestAnimationFrame(dibujar);
    };
    const observador = new IntersectionObserver(([entrada]) => {
      visible = entrada.isIntersecting;
      if (visible && !cuadro) cuadro = requestAnimationFrame(dibujar);
    });
    observador.observe(elemento);
    return () => {
      cancelAnimationFrame(cuadro);
      observador.disconnect();
    };
  }, [intensidad]);
  return <canvas ref={lienzo} className="xn-sismografo" aria-hidden="true" />;
}

export function DemostracionSismo({ alCerrar }) {
  const principal = useReferencia(null);
  const [ayuda, cambiarAyuda] = useEstado(false);
  useEfecto(() => {
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    principal.current?.focus();
    const tecla = (evento) => {
      if (evento.key === 'Escape') alCerrar();
    };
    document.addEventListener('keydown', tecla);
    return () => {
      document.body.style.overflow = anterior;
      document.removeEventListener('keydown', tecla);
    };
  }, [alCerrar]);
  return (
    <div
      className="xn-interrupcion severidad-critica"
      role="dialog"
      aria-modal="true"
      aria-labelledby="demo-titulo"
    >
      <div className="xn-interrupcion-interior">
        <header className="xn-interrupcion-cabecera">
          <span>Alerta crítica</span>
        </header>
        <p className="xn-interrupcion-simulacro">
          Demostración. No es una emergencia real.
        </p>
        <div className="xn-interrupcion-cuerpo">
          <Triangulo className="xn-interrupcion-icono" strokeWidth={2.2} />
          <h1 id="demo-titulo">Sismo</h1>
          <p>Evacúa por la salida más cercana. No uses el ascensor.</p>
        </div>
        <div>
          {ayuda && (
            <p className="xn-interrupcion-enviado" role="status">
              En una alerta real, aquí se envía tu ubicación al personal de
              control.
            </p>
          )}
          <div className="xn-interrupcion-botones">
            <button
              ref={principal}
              type="button"
              className="xn-interrupcion-boton"
              onClick={alCerrar}
            >
              Entendido
            </button>
            <button
              type="button"
              className="xn-interrupcion-boton xn-interrupcion-boton--ayuda"
              onClick={() => cambiarAyuda(true)}
            >
              <Ayuda size={24} />
              Necesito ayuda
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

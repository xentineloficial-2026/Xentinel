/** Producto a escala en la portada: teléfono con carnet y panel de vidrio, con datos de ejemplo declarados. */
import { useEffect as useEfecto, useState as useEstado } from 'react';
import { QRCodeSVG as CodigoQr } from 'qrcode.react';
import {
  Bell as Campana,
  CalendarDays as Calendario,
  DoorOpen as Puerta,
  House as Casa,
  LayoutDashboard as Tablero,
  QrCode as Codigo,
  ScanLine as Escaner,
  UsersRound as Personas,
} from 'lucide-react';
import { SimboloXentinel } from '../../compartido/identidad/Marca.jsx';

const PESTANAS = [
  [Casa, 'Inicio'],
  [Codigo, 'Carnet'],
  [Escaner, 'Escanear'],
  [Campana, 'Alertas'],
];

export function VitrinaTelefono() {
  const [giro, cambiarGiro] = useEstado(0); // Cambia el código y reinicia la barra cada 15 segundos.
  useEfecto(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const temporizador = setInterval(
      () => cambiarGiro((valor) => valor + 1),
      15000
    );
    return () => clearInterval(temporizador);
  }, []);
  return (
    <div className="xn-telefono" aria-hidden="true">
      <div className="xn-telefono-pantalla">
        <div className="xn-telefono-isla" />
        <div className="xn-telefono-cabecera">
          <SimboloXentinel />
          <b>Xentinel</b>
          <span>Permitido</span>
        </div>
        <div className="xn-telefono-qr">
          <CodigoQr
            value={`XENTINEL-EJEMPLO-${giro}`}
            size={220}
            fgColor="#06141b"
          />
        </div>
        <i key={giro} className="xn-telefono-barra" />
        <p className="xn-telefono-nombre">Laura Cano</p>
        <p className="xn-telefono-rol">Aprendiz · Ejemplo</p>
        <nav className="xn-dock">
          <i className="xn-dock-indicador" />
          {PESTANAS.map(([Icono, nombre]) => (
            <span key={nombre}>
              <Icono size={19} />
              {nombre}
            </span>
          ))}
        </nav>
      </div>
    </div>
  );
}

const BARRAS = [
  ['lun', 62],
  ['mar', 88],
  ['mié', 74],
  ['jue', 96],
  ['vie', 81],
  ['sáb', 28],
  ['dom', 12],
];
const MOVIMIENTOS = [
  ['08:20', 'Ana Rojas', 'Entrada', 'Permitido'],
  ['08:19', 'Mateo Torres', 'Salida', 'Permitido'],
  ['08:18', 'Sara Vélez', 'Entrada', 'Permitido'],
  ['08:17', 'Juan Peña', 'Entrada', 'Denegado'],
];

export function VitrinaPanel() {
  return (
    <div className="xn-vitrina" aria-hidden="true">
      <aside className="xn-vitrina-lateral">
        <span className="xn-vitrina-marca">
          <SimboloXentinel />
          Xentinel
        </span>
        <span className="activo">
          <Tablero size={16} />
          Mi día
        </span>
        <span>
          <Puerta size={16} />
          Ingresos
        </span>
        <span>
          <Personas size={16} />
          Personas
        </span>
        <span>
          <Calendario size={16} />
          Asistencia
        </span>
        <span>
          <Campana size={16} />
          Alertas
        </span>
      </aside>
      <div className="xn-vitrina-cuerpo">
        <div className="xn-vitrina-titulo">
          <b>Hola, Ana</b>
          <span>Datos de ejemplo</span>
        </div>
        <div className="xn-vitrina-cifras">
          {[
            ['Dentro ahora', '1 284'],
            ['Entradas hoy', '2 146'],
            ['Asistencia', '94 %'],
            ['Alertas activas', '0'],
          ].map(([nombre, valor]) => (
            <div key={nombre} className="xn-vitrina-tarjeta">
              <span>{nombre}</span>
              <strong>{valor}</strong>
            </div>
          ))}
        </div>
        <div className="xn-vitrina-graficas">
          <div className="xn-vitrina-tarjeta xn-vitrina-barras">
            <span>Ingresos de la semana</span>
            <div>
              {BARRAS.map(([dia, valor]) => (
                <i key={dia} style={{ '--v': `${valor}%` }}>
                  <small>{dia}</small>
                </i>
              ))}
            </div>
          </div>
          <div className="xn-vitrina-tarjeta xn-vitrina-dona">
            <span>Resultado</span>
            <svg viewBox="0 0 42 42">
              <circle cx="21" cy="21" r="15.9" />
              <circle cx="21" cy="21" r="15.9" pathLength="100" />
            </svg>
            <strong>97 %</strong>
            <small>permitidos</small>
          </div>
          <div className="xn-vitrina-tarjeta xn-vitrina-lista">
            <span>Últimos movimientos</span>
            {MOVIMIENTOS.map(([hora, nombre, tipo, estado]) => (
              <p key={hora}>
                <time>{hora}</time>
                <b>{nombre}</b>
                <small>{tipo}</small>
                <em className={estado === 'Permitido' ? '' : 'no'}>{estado}</em>
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

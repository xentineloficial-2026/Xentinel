/** Entrada del módulo admin: mantiene sus permisos y composición en una sola configuración. */
import { PanelTrabajo } from '../../estructura/PanelTrabajo.jsx';
export default function PanelAdministrador() {
  return <PanelTrabajo rolEsperado="admin" />;
}

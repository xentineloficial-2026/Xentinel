/** Raíz de la aplicación: una única sesión compartida por formularios y rutas. */
import { ProveedorAutenticacion } from './compartido/contextos/ProveedorAutenticacion.jsx';
import { RutasAplicacion } from './rutas/RutasAplicacion.jsx';
function Aplicacion() {
  return (
    <ProveedorAutenticacion>
      <RutasAplicacion />
    </ProveedorAutenticacion>
  );
}
export { Aplicacion as default };

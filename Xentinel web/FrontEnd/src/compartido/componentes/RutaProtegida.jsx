/** Protege la navegación por sesión y rol; la API aplica la autorización definitiva. */
import { useContext as useContexto } from 'react';
import {
  Navigate as Redirigir,
  Outlet as ContenidoRuta,
  useLocation as useUbicacion,
} from 'react-router-dom';
import { ContextoAutenticacion } from '../contextos/autenticacion.js';
import {
  inicioParaUsuario,
  rolParaUsuario,
} from '../../configuracion/navegacion.js';
export function RutaProtegida({ children: contenido, rolPermitido }) {
  /* usuario: valor de trabajo utilizado en esta operación. */
  const { usuario } = useContexto(ContextoAutenticacion);
  /* ubicacionRuta: valor de trabajo utilizado en esta operación. */
  const ubicacionRuta = useUbicacion();
  if (!usuario)
    return (
      <Redirigir
        to="/login"
        replace
        state={{
          from: ubicacionRuta.pathname + ubicacionRuta.search,
        }}
      />
    );
  if (rolPermitido && rolParaUsuario(usuario) !== rolPermitido)
    return <Redirigir to={inicioParaUsuario(usuario)} replace />;
  return contenido || <ContenidoRuta />;
}

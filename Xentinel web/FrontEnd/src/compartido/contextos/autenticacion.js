/** Contexto compartido entre rutas públicas y paneles protegidos. */
import {
  createContext as crearContexto,
  useContext as useContexto,
} from 'react';
/* ContextoAutenticacion: valor de trabajo utilizado en esta operación. */
const ContextoAutenticacion = crearContexto(null);
export { ContextoAutenticacion };
/* useAutenticacion: operación local que atiende el evento o transforma la información. */
const useAutenticacion = () => useContexto(ContextoAutenticacion);
export { useAutenticacion };

/** Contexto de la preferencia visual; el proveedor conserva el valor y el conmutador solicita el cambio. */
import {
  createContext as crearContexto,
  useContext as useContexto,
} from 'react';
/* ContextoTema: valor de trabajo utilizado en esta operación. */
const ContextoTema = crearContexto(null);
export { ContextoTema };
/* useTema: operación local que atiende el evento o transforma la información. */
const useTema = () => useContexto(ContextoTema);
export { useTema };

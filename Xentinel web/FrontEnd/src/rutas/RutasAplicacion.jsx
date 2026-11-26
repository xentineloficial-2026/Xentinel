/** Rutas públicas y módulos por rol. Los alias conservan enlaces antiguos y el servidor autoriza los datos. */
import { lazy as cargaDiferida, Suspense as Espera } from 'react';
import {
  Routes as Rutas,
  Route as Ruta,
  Link as Enlace,
  Navigate as Redirigir,
  useLocation as useUbicacion,
} from 'react-router-dom';
import { RutaProtegida } from '../compartido/componentes/RutaProtegida.jsx';
import { EstructuraPublica } from '../modulos/publico/EstructuraPublica.jsx';
import { Bienvenida } from '../modulos/publico/Inicio.jsx';
import { Plataforma } from '../modulos/publico/Plataforma.jsx';
import { Contactos } from '../modulos/publico/Contactos.jsx';
import { Servicios } from '../modulos/publico/Servicios.jsx';
import {
  CondicionesServicio,
  PoliticaPrivacidad,
} from '../modulos/publico/Legal.jsx';
import { InicioSesion } from '../modulos/autenticacion/InicioSesion.jsx';
import { Registro } from '../modulos/autenticacion/Registro.jsx';
import {
  RecuperarContrasena,
  RestablecerContrasena,
} from '../modulos/autenticacion/RecuperarContrasena.jsx';
/* PanelAdministrador: valor de trabajo utilizado en esta operación. */
const PanelAdministrador = cargaDiferida(
  () => import('../modulos/admin/PanelAdministrador.jsx')
);
/* PanelInstructor: valor de trabajo utilizado en esta operación. */
const PanelInstructor = cargaDiferida(
  () => import('../modulos/instructor/PanelInstructor.jsx')
);
/* PanelCelador: valor de trabajo utilizado en esta operación. */
const PanelCelador = cargaDiferida(
  () => import('../modulos/celador/PanelCelador.jsx')
);
/* PanelVisitante: valor de trabajo utilizado en esta operación. */
const PanelVisitante = cargaDiferida(
  () => import('../modulos/visitante/PanelVisitante.jsx')
);
export function RutasAplicacion() {
  // Un enlace nuevo debe descartar la verificación anterior, incluso si solo cambia el fragmento.
  const ubicacion = useUbicacion();
  return (
    <Espera
      fallback={
        <div role="status" className="xn-route-carga">
          Preparando tu espacio…
        </div>
      }
    >
      <Rutas>
        <Ruta element={<EstructuraPublica />}>
          <Ruta index element={<Bienvenida />} />
          <Ruta path="plataforma" element={<Plataforma />} />
          <Ruta path="contacto" element={<Contactos />} />
          <Ruta path="servicios" element={<Servicios />} />
          <Ruta path="privacidad" element={<PoliticaPrivacidad />} />
          <Ruta path="terminos" element={<CondicionesServicio />} />
          <Ruta path="login" element={<InicioSesion />} />
          <Ruta path="registro" element={<Registro />} />
          <Ruta path="recuperar-contrasena" element={<RecuperarContrasena />} />
          <Ruta
            path="restablecer-contrasena"
            element={
              <RestablecerContrasena key={ubicacion.search + ubicacion.hash} />
            }
          />
          <Ruta
            path="*"
            element={
              <section className="xn-seccion xn-pagina">
                <p className="xn-antetitulo">404</p>
                <h1>Esta página tomó otro camino.</h1>
                <p className="xn-pagina-introduccion">
                  Vuelve al inicio para encontrar lo que necesitas.
                </p>
                <Enlace className="xn-boton" to="/">
                  Volver al inicio
                </Enlace>
              </section>
            }
          />
        </Ruta>
        {[
          ['admin', PanelAdministrador],
          ['instructor', PanelInstructor],
          ['celador', PanelCelador],
          ['visitante', PanelVisitante],
        ].map(([rol, Panel]) => (
          <Ruta
            key={rol}
            path={`/${rol}/*`}
            element={
              <RutaProtegida rolPermitido={rol}>
                <Panel />
              </RutaProtegida>
            }
          />
        ))}
        {['aprendiz', 'usuarionuevo', 'usernuevo'].map((ruta) => (
          <Ruta
            key={ruta}
            path={`/${ruta}/*`}
            element={<Redirigir to="/visitante" replace />}
          />
        ))}
        <Ruta
          path="iniciar-sesion"
          element={<Redirigir to="/login" replace />}
        />
      </Rutas>
    </Espera>
  );
}

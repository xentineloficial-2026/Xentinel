/** Formulario de acceso con validación, sesión compartida y regreso a la ruta autorizada. */
import {
  useContext as useContexto,
  useRef as useReferencia,
  useState as useEstado,
} from 'react';
import {
  Link as Enlace,
  useLocation as useUbicacion,
  useNavigate as useNavegacion,
} from 'react-router-dom';
import { ArrowUpRight as FlechaDiagonal } from 'lucide-react';
import { SimboloXentinel } from '../../compartido/identidad/Marca.jsx';
import { Perimetro } from '../../compartido/identidad/Perimetro.jsx';
import { ContextoAutenticacion } from '../../compartido/contextos/autenticacion.js';
import { solicitar } from '../../compartido/servicios/cliente.js';
import { destinoTrasAcceso } from '../../configuracion/navegacion.js';
import { CampoContrasena } from '../../compartido/componentes/CampoContrasena.jsx';
function InicioSesion() {
  /* documento, cambiarDocumento: estado de la vista y función para actualizarlo. */
  const [documento, cambiarDocumento] = useEstado('');
  /* contrasena, cambiarContrasena: estado de la vista y función para actualizarlo. */
  const [contrasena, cambiarContrasena] = useEstado('');
  /* error, cambiarError: estado de la vista y función para actualizarlo. */
  const [error, cambiarError] = useEstado('');
  /* cargando, cambiarCargando: estado de la vista y función para actualizarlo. */
  const [cargando, cambiarCargando] = useEstado(false);
  /* ocupado: referencia estable entre renderizados, sin disparar una actualización visual. */
  const ocupado = useReferencia(false);
  /* iniciarSesion, mensajeSesion: valor de trabajo utilizado en esta operación. */
  const { iniciarSesion, mensajeSesion } = useContexto(ContextoAutenticacion);
  /* navegar: valor de trabajo utilizado en esta operación. */
  const navegar = useNavegacion();
  /* ubicacionRuta: valor de trabajo utilizado en esta operación. */
  const ubicacionRuta = useUbicacion();
  /* enviar: operación local que atiende el evento o transforma la información. */
  const enviar = async (evento) => {
    evento.preventDefault();
    if (ocupado.current) return;
    cambiarError('');
    if (!documento.trim() || !contrasena) {
      cambiarError('Ingresa tu documento y contraseña.');
      document
        .getElementById(!documento.trim() ? 'documento' : 'password')
        .focus();
      return;
    }
    ocupado.current = true;
    cambiarCargando(true);
    try {
      /* data, datos: valor de trabajo utilizado en esta operación. */
      const { data: datos } = await solicitar('/auth/login', {
        method: 'POST',
        body: {
          documento: documento.trim(),
          contrasena,
        },
        publicRequest: true,
      });
      iniciarSesion(datos);
      navegar(destinoTrasAcceso(datos.usuario, ubicacionRuta.state?.from), {
        replace: true,
      });
    } catch (motivo) {
      cambiarError(motivo.message);
    } finally {
      ocupado.current = false;
      cambiarCargando(false);
    }
  };
  return (
    <section className="xn-acceso">
      <div className="xn-acceso-introduccion">
        <Perimetro />
        <SimboloXentinel className="xn-acceso-simbolo" />
        <h1>
          Tu comunidad.
          <br />
          Tu espacio seguro.
        </h1>
        <p>
          Ingresa para acceder a las herramientas de gestión disponibles para tu
          rol.
        </p>
        <Enlace to="/plataforma" className="xn-texto-enlace">
          Explorar la plataforma <FlechaDiagonal size={16} />
        </Enlace>
      </div>
      <div className="xn-acceso-tarjeta">
        <h2>Iniciar sesión</h2>
        <p>Usa los datos de tu cuenta institucional.</p>
        {mensajeSesion && (
          <div className="xn-acceso-error" role="status">
            {mensajeSesion}
          </div>
        )}
        <form noValidate onSubmit={enviar}>
          <div className="xn-campo">
            <label htmlFor="documento">Número de documento</label>
            <input
              id="documento"
              name="documento"
              autoComplete="username"
              value={documento}
              onChange={(evento) => cambiarDocumento(evento.target.value)}
              placeholder="Ingresa tu documento"
              required
              aria-invalid={!!error}
              aria-describedby={error ? 'login-error' : undefined}
            />
          </div>
          <CampoContrasena
            identificador="password"
            etiqueta="Contraseña"
            autocompletado="current-password"
            valor={contrasena}
            alCambiar={(evento) => cambiarContrasena(evento.target.value)}
          />
          <Enlace to="/recuperar-contrasena" className="xn-texto-enlace">
            ¿Olvidaste tu contraseña?
          </Enlace>
          {error && (
            <div className="xn-acceso-error" id="login-error" role="alert">
              {error}
            </div>
          )}
          <button type="submit" className="xn-boton" disabled={cargando}>
            {cargando ? 'Iniciando sesión…' : 'Iniciar sesión'}
            <FlechaDiagonal size={16} />
          </button>
        </form>
        <p className="xn-acceso-final">
          ¿Aún no tienes cuenta?{' '}
          <Enlace to="/registro" viewTransition className="xn-texto-enlace">
            Crear cuenta
          </Enlace>
        </p>
      </div>
    </section>
  );
}
export { InicioSesion };

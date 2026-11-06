/** Registro público: valida los campos y utiliza el contrato actual de /auth/registro. */
import { useRef as useReferencia, useState as useEstado } from 'react';
import { Link as Enlace } from 'react-router-dom';
import { solicitar } from '../../compartido/servicios/cliente.js';
import { errorContrasena } from '../../compartido/servicios/recuperacion.js';
import { MensajeEstado } from '../../compartido/componentes/MensajeEstado.jsx';
import { CampoContrasena } from '../../compartido/componentes/CampoContrasena.jsx';
import { SimboloXentinel } from '../../compartido/identidad/Marca.jsx';
import { Perimetro } from '../../compartido/identidad/Perimetro.jsx';
function Registro() {
  /* formulario, cambiarFormulario: estado de la vista y función para actualizarlo. */
  const [formulario, cambiarFormulario] = useEstado({
    nombres_completos: '',
    tipo_documento: 'CC',
    numero_documento: '',
    correo: '',
    contrasena: '',
  });
  /* confirmacion, cambiarConfirmacion: estado de la vista y función para actualizarlo. */
  const [confirmacion, cambiarConfirmacion] = useEstado('');
  /* error, cambiarError: estado de la vista y función para actualizarlo. */
  const [error, cambiarError] = useEstado(null);
  /* guardando, cambiarGuardando: estado de la vista y función para actualizarlo. */
  const [guardando, cambiarGuardando] = useEstado(false);
  /* completado, cambiarCompletado: estado de la vista y función para actualizarlo. */
  const [completado, cambiarCompletado] = useEstado(false);
  /* ocupado: referencia estable entre renderizados, sin disparar una actualización visual. */
  const ocupado = useReferencia(false);
  /* cambiar: operación local que atiende el evento o transforma la información. */
  const cambiar = (clave, valor) =>
    cambiarFormulario((actual) => ({
      ...actual,
      [clave]: valor,
    }));
  /* enviar: operación local que atiende el evento o transforma la información. */
  const enviar = async (evento) => {
    evento.preventDefault();
    if (ocupado.current) return;
    cambiarError(null);
    /* problema: valor de trabajo utilizado en esta operación. */
    const problema =
      formulario.nombres_completos.trim().length < 2
        ? 'Escribe tu nombre completo.'
        : !/^[A-Za-z0-9-]{3,20}$/.test(formulario.numero_documento)
          ? 'Revisa tu número de documento.'
          : !/^\S+@\S+\.\S+$/.test(formulario.correo)
            ? 'Escribe un correo válido.'
            : errorContrasena(formulario.contrasena) ||
              (formulario.contrasena !== confirmacion
                ? 'Las contraseñas no coinciden.'
                : '');
    if (problema) {
      cambiarError(problema);
      return;
    }
    ocupado.current = true;
    cambiarGuardando(true);
    try {
      await solicitar('/auth/registro', {
        method: 'POST',
        body: {
          ...formulario,
          nombres_completos: formulario.nombres_completos.trim(),
          correo: formulario.correo.trim(),
        },
        publicRequest: true,
      });
      cambiarCompletado(true);
      cambiarFormulario({
        ...formulario,
        contrasena: '',
      });
      cambiarConfirmacion('');
    } catch (motivo) {
      cambiarError(motivo);
    } finally {
      ocupado.current = false;
      cambiarGuardando(false);
    }
  };
  return (
    <section className="xn-acceso xn-acceso--registro">
      <div className="xn-acceso-introduccion">
        <Perimetro />
        <SimboloXentinel className="xn-acceso-simbolo" />
        <h1>
          Tu comunidad
          <br />
          te espera.
        </h1>
        <p>
          Crea tu cuenta para consultar tu información y gestionar tus accesos.
        </p>
      </div>
      <div className="xn-acceso-tarjeta">
        <h2>{completado ? 'Ya eres parte de Xentinel.' : 'Crear cuenta'}</h2>
        {completado ? (
          <>
            <p>
              Tu cuenta está lista. Inicia sesión con tu documento y contraseña.
            </p>
            <Enlace to="/login" className="xn-boton">
              Iniciar sesión
            </Enlace>
          </>
        ) : (
          <form noValidate onSubmit={enviar}>
            <div className="xn-campo">
              <label htmlFor="register-name">Nombre completo</label>
              <input
                id="register-name"
                autoComplete="name"
                maxLength={150}
                value={formulario.nombres_completos}
                onChange={(evento) =>
                  cambiar('nombres_completos', evento.target.value)
                }
              />
            </div>
            <div className="xn-campo">
              <label htmlFor="register-type">Tipo de documento</label>
              <select
                id="register-type"
                value={formulario.tipo_documento}
                onChange={(evento) =>
                  cambiar('tipo_documento', evento.target.value)
                }
              >
                {['CC', 'TI', 'CE', 'PA', 'PEP', 'PPT'].map((tipo) => (
                  <option key={tipo}>{tipo}</option>
                ))}
              </select>
            </div>
            <div className="xn-campo">
              <label htmlFor="register-document">Número de documento</label>
              <input
                id="register-document"
                maxLength={20}
                value={formulario.numero_documento}
                onChange={(evento) =>
                  cambiar('numero_documento', evento.target.value)
                }
              />
            </div>
            <div className="xn-campo">
              <label htmlFor="register-email">Correo electrónico</label>
              <input
                id="register-email"
                type="email"
                autoComplete="email"
                maxLength={254}
                value={formulario.correo}
                onChange={(evento) => cambiar('correo', evento.target.value)}
              />
            </div>
            <CampoContrasena
              identificador="register-password"
              etiqueta="Contraseña"
              autocompletado="new-password"
              valor={formulario.contrasena}
              alCambiar={(evento) => cambiar('contrasena', evento.target.value)}
              ayuda="Usa al menos 12 caracteres; máximo 72 bytes UTF-8."
            />
            <CampoContrasena
              identificador="register-confirmation"
              etiqueta="Confirmar contraseña"
              autocompletado="new-password"
              valor={confirmacion}
              alCambiar={(evento) => cambiarConfirmacion(evento.target.value)}
            />
            <MensajeEstado error={error} />
            <button className="xn-boton" disabled={guardando}>
              {guardando ? 'Creando tu cuenta…' : 'Crear mi cuenta'}
            </button>
            <p className="xn-acceso-final">
              ¿Ya tienes cuenta?{' '}
              <Enlace className="xn-texto-enlace" to="/login" viewTransition>
                Iniciar sesión
              </Enlace>
            </p>
          </form>
        )}
      </div>
    </section>
  );
}
export { Registro };

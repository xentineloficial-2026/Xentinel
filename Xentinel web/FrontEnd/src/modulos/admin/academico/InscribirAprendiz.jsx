/** Crear un aprendiz que queda vinculado a la ficha en la misma operación. */
import './academico.css';
import { useState } from 'react';
import { Dialogo } from '../../../compartido/componentes/Dialogo.jsx';
import { MensajeEstado } from '../../../compartido/componentes/MensajeEstado.jsx';
import { CampoContrasena } from '../../../compartido/componentes/CampoContrasena.jsx';
import { errorContrasena } from '../../../compartido/servicios/recuperacion.js';
import { solicitar } from '../../../compartido/servicios/cliente.js';
import { useRolAprendiz } from './utilidades.js';

const TIPOS = ['CC', 'TI', 'CE', 'PA', 'PEP', 'PPT'];

export function InscribirAprendiz({ ficha, alCerrar, alGuardar }) {
  const [datos, cambiarDatos] = useState({
    nombres_completos: '',
    tipo_documento: 'TI',
    numero_documento: '',
    correo: '',
    telefono: '',
    contrasena: '',
  });
  const [estado, cambiarEstado] = useState({});
  const [ocupado, cambiarOcupado] = useState(false);
  const { id: rolAprendiz, roles } = useRolAprendiz();
  const cambiar = (campo) => (evento) =>
    cambiarDatos((actual) => ({ ...actual, [campo]: evento.target.value }));

  async function inscribir(evento) {
    evento.preventDefault();
    if (ocupado) return;
    const problema =
      datos.nombres_completos.trim().length < 2
        ? 'Escribe el nombre completo.'
        : !/^[A-Za-z0-9-]{3,20}$/.test(datos.numero_documento)
          ? 'Revisa el documento: entre 3 y 20 letras, números o guiones.'
          : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.correo.trim())
            ? 'Escribe un correo válido.'
            : datos.contrasena && errorContrasena(datos.contrasena);
    if (problema) {
      cambiarEstado({ error: problema });
      return;
    }
    cambiarOcupado(true);
    cambiarEstado({});
    try {
      const { data } = await solicitar('/usuarios', {
        method: 'POST',
        body: {
          nombres_completos: datos.nombres_completos.trim(),
          tipo_documento: datos.tipo_documento,
          numero_documento: datos.numero_documento.trim(),
          correo: datos.correo.trim(),
          telefono: datos.telefono.trim(),
          id_rol: rolAprendiz,
          id_ficha: ficha.id_ficha,
          ...(datos.contrasena && { contrasena: datos.contrasena }),
        },
      });
      alGuardar(
        `${data.nombres_completos} quedó inscrito en la ficha ${ficha.numero_ficha}.`
      );
    } catch (error) {
      cambiarEstado({ error });
      cambiarOcupado(false);
    }
  }

  return (
    <Dialogo
      titulo={`Inscribir aprendiz en la ficha ${ficha.numero_ficha}`}
      alCerrar={alCerrar}
      ocupado={ocupado}
    >
      <form onSubmit={inscribir} noValidate>
        <fieldset className="xn-admin-campos" disabled={ocupado}>
          <div className="xn-formulario-cuadricula">
            <div className="xn-campo xn-campo--ancho">
              <label htmlFor="inscribir-nombre">Nombre completo</label>
              <input
                id="inscribir-nombre"
                data-initial-focus
                maxLength={150}
                autoComplete="off"
                value={datos.nombres_completos}
                onChange={cambiar('nombres_completos')}
              />
            </div>
            <div className="xn-campo">
              <label htmlFor="inscribir-tipo">Tipo de documento</label>
              <select
                id="inscribir-tipo"
                value={datos.tipo_documento}
                onChange={cambiar('tipo_documento')}
              >
                {TIPOS.map((tipo) => (
                  <option key={tipo}>{tipo}</option>
                ))}
              </select>
            </div>
            <div className="xn-campo">
              <label htmlFor="inscribir-documento">Número de documento</label>
              <input
                id="inscribir-documento"
                inputMode="numeric"
                autoComplete="off"
                value={datos.numero_documento}
                onChange={cambiar('numero_documento')}
              />
            </div>
            <div className="xn-campo">
              <label htmlFor="inscribir-correo">Correo</label>
              <input
                id="inscribir-correo"
                type="email"
                autoComplete="off"
                value={datos.correo}
                onChange={cambiar('correo')}
              />
            </div>
            <div className="xn-campo">
              <label htmlFor="inscribir-telefono">Teléfono (opcional)</label>
              <input
                id="inscribir-telefono"
                type="tel"
                maxLength={20}
                value={datos.telefono}
                onChange={cambiar('telefono')}
              />
            </div>
            <CampoContrasena
              identificador="inscribir-contrasena"
              etiqueta="Contraseña inicial (opcional)"
              valor={datos.contrasena}
              alCambiar={cambiar('contrasena')}
              ayuda="Si la dejas vacía, será el número de documento."
            />
          </div>
          <p className="xn-ayuda">
            El aprendiz queda activo, vinculado a esta ficha y con su carnet QR
            listo para registrar asistencia desde hoy.
          </p>
        </fieldset>
        {roles.estado === 'error' && <MensajeEstado error={roles.error} />}
        <MensajeEstado {...estado} />
        <div className="xn-dialogo-acciones">
          <button
            type="button"
            className="xn-boton xn-boton--secundario"
            disabled={ocupado}
            onClick={alCerrar}
          >
            Cancelar
          </button>
          <button className="xn-boton" disabled={ocupado || !rolAprendiz}>
            {ocupado ? 'Inscribiendo…' : 'Inscribir aprendiz'}
          </button>
        </div>
      </form>
    </Dialogo>
  );
}

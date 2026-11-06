/** Campo de contraseña con etiqueta, ayuda y visibilidad controlada por la persona. */
import { useState as useEstado } from 'react';
import { Eye as Ojo, EyeOff as OjoOculto } from 'lucide-react';
export function CampoContrasena({
  identificador,
  etiqueta,
  valor,
  alCambiar,
  autocompletado = 'new-password',
  error,
  ayuda,
}) {
  const [visible, cambiarVisible] = useEstado(false); // Visibilidad local; la contraseña nunca se guarda por este componente.
  return (
    <div className="xn-campo">
      <label htmlFor={identificador}>{etiqueta}</label>
      <div className="xn-contrasena">
        <input
          id={identificador}
          name={identificador}
          type={visible ? 'text' : 'password'}
          value={valor}
          onChange={alCambiar}
          autoComplete={autocompletado}
          required
          aria-invalid={!!error}
          aria-describedby={
            error || ayuda ? `${identificador}-ayuda` : undefined
          }
        />
        <button
          type="button"
          aria-label={`${visible ? 'Ocultar' : 'Mostrar'} ${etiqueta.toLowerCase()}`}
          aria-pressed={visible}
          onClick={() => cambiarVisible(!visible)}
        >
          {visible ? <OjoOculto size={18} /> : <Ojo size={18} />}
        </button>
      </div>
      {(error || ayuda) && (
        <small id={`${identificador}-ayuda`}>{error || ayuda}</small>
      )}
    </div>
  );
}

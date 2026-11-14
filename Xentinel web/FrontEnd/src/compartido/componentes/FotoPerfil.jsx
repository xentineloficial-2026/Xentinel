/** Foto circular con subida: muestra la vista previa al elegir y valida tipo y tamaño antes de enviar. */
import {
  useEffect as useEfecto,
  useId as useIdentificador,
  useState as useEstado,
} from 'react';
import { Camera as Camara } from 'lucide-react';
import { errorFoto, leerFoto } from '../servicios/fotos.js';

export function FotoPerfil({ fotoUrl, nombre, alElegir, deshabilitado }) {
  const campo = useIdentificador();
  const [remota, cambiarRemota] = useEstado(null);
  const [local, cambiarLocal] = useEstado(null);
  const [error, cambiarError] = useEstado('');
  useEfecto(() => {
    const controlador = new AbortController();
    let creada;
    leerFoto(fotoUrl, controlador.signal)
      .then((url) => {
        creada = url;
        cambiarRemota(url);
      })
      .catch(() => {});
    return () => {
      controlador.abort();
      if (creada) URL.revokeObjectURL(creada);
    };
  }, [fotoUrl]);
  useEfecto(() => () => local && URL.revokeObjectURL(local), [local]);
  const elegir = (evento) => {
    const archivo = evento.target.files?.[0];
    evento.target.value = '';
    if (!archivo) return;
    const motivo = errorFoto(archivo);
    cambiarError(motivo);
    if (motivo) return;
    cambiarLocal(URL.createObjectURL(archivo));
    alElegir(archivo);
  };
  const imagen = local || remota;
  return (
    <div className="xn-foto">
      <label
        htmlFor={campo}
        className={`xn-foto-circulo${deshabilitado ? ' esta-deshabilitado' : ''}`}
      >
        {imagen ? (
          <img src={imagen} alt={`Foto de ${nombre || 'la persona'}`} />
        ) : (
          <span className="xn-foto-vacia">
            <Camara size={22} />
            Subir foto
          </span>
        )}
        {imagen && (
          <span className="xn-foto-cambiar">
            <Camara size={20} />
            Cambiar
          </span>
        )}
      </label>
      <input
        id={campo}
        className="xn-solo-lectores"
        type="file"
        accept=".jpeg,.jpg,.png,.gif,image/jpeg,image/png,image/gif"
        disabled={deshabilitado}
        onChange={elegir}
      />
      <p className="xn-foto-ayuda">
        Permitidos *.jpeg, *.jpg, *.png, *.gif
        <br />
        Tamaño máximo de 3 MB
      </p>
      {error && (
        <p className="xn-foto-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Interruptor accesible con su descripción, como el de las referencias. */
export function Interruptor({
  etiqueta,
  descripcion,
  activo,
  alCambiar,
  deshabilitado,
}) {
  const campo = useIdentificador();
  return (
    <div className="xn-interruptor">
      <div>
        <label htmlFor={campo}>{etiqueta}</label>
        {descripcion && <p>{descripcion}</p>}
      </div>
      <button
        id={campo}
        type="button"
        role="switch"
        aria-checked={activo}
        disabled={deshabilitado}
        onClick={() => alCambiar(!activo)}
      >
        <span />
      </button>
    </div>
  );
}

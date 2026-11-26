/** Páginas legales públicas: Política de Privacidad y Condiciones del Servicio. */
import { Link as Enlace } from 'react-router-dom';

const VIGENCIA = '26 de noviembre de 2026';
const CORREO = 'xentinel.oficial@gmail.com';

function Documento({ titulo, introduccion, secciones, otro }) {
  return (
    <section className="xn-seccion xn-pagina xn-legal">
      <h1>{titulo}</h1>
      <p className="xn-pagina-introduccion">{introduccion}</p>
      <p className="xn-legal-vigencia">Vigente desde el {VIGENCIA}.</p>
      <article className="xn-legal-texto">
        {secciones.map(([subtitulo, contenido]) => (
          <section key={subtitulo}>
            <h2>{subtitulo}</h2>
            {contenido}
          </section>
        ))}
      </article>
      <p className="xn-legal-otro">
        Consulta también {otro}. Para cualquier duda escribe a{' '}
        <a className="xn-texto-enlace" href={`mailto:${CORREO}`}>
          {CORREO}
        </a>
        .
      </p>
    </section>
  );
}

const SECCIONES_PRIVACIDAD = [
  [
    'Quién es el responsable',
    <p key="r">
      Xentinel es la plataforma de gestión y control de acceso del SENA, sede
      Fontibón (Bogotá D.C., Colombia), desarrollada por un equipo de formación
      ADSO. Xentinel trata tus datos personales según la Ley 1581 de 2012 y el
      Decreto 1074 de 2015. Puedes contactarnos en {CORREO}.
    </p>,
  ],
  [
    'Qué datos tratamos',
    <ul key="d">
      <li>
        <strong>Cuenta:</strong> nombre completo, tipo y número de documento,
        correo, rol y, si los das, teléfono, fecha de nacimiento y foto de
        perfil.
      </li>
      <li>
        <strong>Formación:</strong> programa, ficha, jornada y horarios que te
        asigna la administración.
      </li>
      <li>
        <strong>Ingresos y asistencia:</strong> fecha y hora de cada entrada y
        salida, el método (QR o manual), quién la registró y tu estado de
        asistencia.
      </li>
      <li>
        <strong>Emergencias:</strong> tu ubicación solo cuando tú envías un SOS
        durante una alerta, y los pases de lista que hace tu instructor.
      </li>
      <li>
        <strong>Seguridad:</strong> la huella cifrada de un código QR rechazado
        (no su contenido) y registros técnicos para limitar abusos.
      </li>
    </ul>,
  ],
  [
    'Para qué los usamos',
    <ul key="f">
      <li>Verificar tu identidad y controlar el acceso a la sede.</li>
      <li>Registrar la asistencia de aprendices y mostrar tu horario.</li>
      <li>
        Avisarte de emergencias y riesgos, como sismos cercanos a la sede.
      </li>
      <li>
        Enviarte por correo los códigos para recuperar tu contraseña o confirmar
        un correo nuevo.
      </li>
    </ul>,
  ],
  [
    'Cámara, huella y notificaciones',
    <p key="p">
      La app usa la cámara solo para leer códigos QR en el punto de control; no
      guarda ni envía imágenes. Si activas el ingreso con huella o rostro, la
      verificación ocurre en tu teléfono y Xentinel nunca recibe esos datos. Las
      notificaciones sirven para las alertas de emergencia y puedes
      desactivarlas en tu teléfono.
    </p>,
  ],
  [
    'Con quién los compartimos',
    <>
      <p key="c">
        No vendemos ni cedemos tus datos. Los guardan y procesan proveedores que
        actúan por cuenta de Xentinel, con las medidas de seguridad de cada
        servicio:
      </p>
      <ul key="l">
        <li>Render: aloja la web y la API (Estados Unidos).</li>
        <li>Supabase: aloja la base de datos (Estados Unidos).</li>
        <li>
          Brevo: envía los correos con códigos de verificación (Unión Europea).
        </li>
        <li>
          Firebase Cloud Messaging, si está activo: entrega las alertas push.
        </li>
      </ul>
      <p key="t">
        Al usar Xentinel autorizas esta transferencia internacional, limitada a
        prestar el servicio.
      </p>
    </>,
  ],
  [
    'Cómo los protegemos',
    <p key="s">
      Toda la comunicación viaja cifrada (HTTPS). Las contraseñas se guardan con
      bcrypt y nunca en texto plano; los códigos de verificación se guardan con
      HMAC y vencen a los 15 minutos; la cola de correo se cifra y se borra al
      enviarse. Cambiar tu contraseña o tu correo cierra las sesiones abiertas.
    </p>,
  ],
  [
    'Cuánto tiempo los conservamos',
    <p key="t">
      Mientras tu cuenta esté activa y durante el tiempo que exijan las normas
      de la institución sobre registros de acceso y asistencia. Al desactivar
      una cuenta se conserva su historial para la trazabilidad de la sede. Los
      códigos de verificación y los mensajes de correo pendientes se eliminan al
      usarse o al vencer.
    </p>,
  ],
  [
    'Tus derechos',
    <>
      <p key="d">
        Puedes conocer, actualizar y rectificar tus datos (muchos desde{' '}
        <strong>Mi perfil</strong>), pedir prueba de la autorización, solicitar
        la supresión cuando no exista un deber legal de conservarlos, revocar tu
        autorización y presentar quejas ante la Superintendencia de Industria y
        Comercio.
      </p>
      <p key="c">
        Escribe a {CORREO} con tu nombre, documento y la solicitud.
        Responderemos consultas en 10 días hábiles y reclamos en 15 días
        hábiles.
      </p>
    </>,
  ],
  [
    'Menores de edad',
    <p key="m">
      Algunos aprendices son menores de edad. Sus datos se tratan solo para los
      fines de la formación y la seguridad en la sede, respetando su interés
      superior, y sus padres o acudientes pueden ejercer los derechos descritos
      arriba.
    </p>,
  ],
  [
    'Almacenamiento en tu navegador',
    <p key="n">
      La web guarda tu sesión mientras la pestaña está abierta y recuerda si
      prefieres el tema claro u oscuro. No usamos cookies de publicidad ni de
      seguimiento.
    </p>,
  ],
  [
    'Cambios a esta política',
    <p key="c">
      Si la cambiamos, publicaremos la nueva versión en esta página con su fecha
      de vigencia.
    </p>,
  ],
];

const SECCIONES_CONDICIONES = [
  [
    'Aceptación',
    <p key="a">
      Al crear una cuenta, ingresar o usar la web o la app de Xentinel aceptas
      estas condiciones y la Política de Privacidad. Si no estás de acuerdo, no
      uses el servicio.
    </p>,
  ],
  [
    'Qué es Xentinel',
    <p key="q">
      Xentinel es la plataforma de gestión y control de acceso del SENA, sede
      Fontibón: carnet digital con código QR, registro de ingresos y salidas,
      asistencia, horarios y alertas de emergencia, en la web y en la app para
      Android.
    </p>,
  ],
  [
    'Tu cuenta',
    <ul key="c">
      <li>
        El registro público crea una cuenta de aprendiz; los demás roles los
        asigna la administración.
      </li>
      <li>Debes dar datos verdaderos y mantenerlos al día desde Mi perfil.</li>
      <li>
        Tu contraseña y tu carnet QR son personales: no los compartas ni dejes
        que otra persona entre con ellos.
      </li>
      <li>
        Si crees que alguien usa tu cuenta, cambia tu contraseña y avisa a la
        administración.
      </li>
    </ul>,
  ],
  [
    'Uso permitido',
    <ul key="u">
      <li>
        No intentes falsificar, copiar ni alterar códigos QR, ni registrar
        movimientos de otras personas sin autorización.
      </li>
      <li>No envíes SOS ni reportes falsos ni uses las alertas para bromas.</li>
      <li>
        No intentes acceder a datos o funciones que tu rol no permite, ni
        interferir con el funcionamiento del servicio.
      </li>
    </ul>,
  ],
  [
    'Alertas de emergencia',
    <p key="e">
      Las alertas de sismos usan datos públicos de agencias sismológicas y se
      publican uno o varios minutos después del evento: no son una alerta
      temprana. Dependen de tu conexión y de que el servicio esté disponible.
      Sigue siempre las indicaciones del personal de emergencia y de las
      autoridades.
    </p>,
  ],
  [
    'Disponibilidad',
    <p key="d">
      Hacemos lo posible por mantener Xentinel disponible, pero el servicio
      puede tener interrupciones o demoras, por ejemplo mientras el servidor se
      reactiva tras un tiempo sin uso. Validar un carnet necesita conexión a
      internet.
    </p>,
  ],
  [
    'App para Android',
    <p key="a">
      Instala la app solo desde la página de descarga oficial de Xentinel. Cada
      versión está firmada por el proyecto y se actualiza instalando la versión
      nueva desde esa misma página.
    </p>,
  ],
  [
    'Suspensión de cuentas',
    <p key="s">
      La administración puede desactivar una cuenta que incumpla estas
      condiciones o que ya no pertenezca a la comunidad de la sede. El historial
      se conserva según la Política de Privacidad.
    </p>,
  ],
  [
    'Propiedad intelectual',
    <p key="p">
      El nombre, el logo, el diseño y el software de Xentinel pertenecen a su
      equipo de desarrollo y al SENA. No puedes copiarlos ni redistribuirlos sin
      autorización.
    </p>,
  ],
  [
    'Responsabilidad',
    <p key="r">
      Xentinel se ofrece como apoyo a los procesos de la sede. En la medida que
      permita la ley, no respondemos por daños derivados de interrupciones del
      servicio, del uso indebido de una cuenta o de información de terceros,
      como la de las agencias sismológicas.
    </p>,
  ],
  [
    'Ley aplicable y cambios',
    <p key="l">
      Estas condiciones se rigen por las leyes de Colombia. Si las cambiamos,
      publicaremos la nueva versión en esta página con su fecha de vigencia.
    </p>,
  ],
];

export function PoliticaPrivacidad() {
  return (
    <Documento
      titulo="Política de Privacidad"
      introduccion="Qué datos personales trata Xentinel, para qué y cómo ejercer tus derechos."
      secciones={SECCIONES_PRIVACIDAD}
      otro={
        <Enlace className="xn-texto-enlace" to="/terminos">
          las Condiciones del Servicio
        </Enlace>
      }
    />
  );
}

export function CondicionesServicio() {
  return (
    <Documento
      titulo="Condiciones del Servicio"
      introduccion="Las reglas para usar la web y la app de Xentinel."
      secciones={SECCIONES_CONDICIONES}
      otro={
        <Enlace className="xn-texto-enlace" to="/privacidad">
          la Política de Privacidad
        </Enlace>
      }
    />
  );
}

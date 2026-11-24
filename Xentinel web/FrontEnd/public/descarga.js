/** Cabecera de la descarga: tema, menú móvil y cápsula de navegación, como en la web principal. */
const raiz = document.documentElement;
const botonTema = document.getElementById('tema');
const botonMenu = document.getElementById('menu');
const navegacion = document.getElementById('navegacion');

function etiquetarTema() {
  const etiqueta =
    raiz.dataset.theme === 'dark'
      ? 'Activar modo claro'
      : 'Activar modo oscuro';
  botonTema.setAttribute('aria-label', etiqueta);
  botonTema.title = etiqueta;
}

function alternarTema() {
  const tema = raiz.dataset.theme === 'dark' ? 'light' : 'dark';
  raiz.dataset.theme = tema;
  raiz.style.colorScheme = tema;
  try {
    localStorage.setItem('xentinel-theme', tema);
  } catch {
    /* La preferencia funciona en memoria si el almacenamiento no está disponible. */
  }
  etiquetarTema();
}

/* El tema nuevo se revela en círculo desde el clic, igual que en la portada. */
botonTema.addEventListener('click', (evento) => {
  if (
    !document.startViewTransition ||
    matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    alternarTema();
    return;
  }
  const { clientX: x, clientY: y } = evento;
  const radio = Math.hypot(
    Math.max(x, innerWidth - x),
    Math.max(y, innerHeight - y)
  );
  document
    .startViewTransition(alternarTema)
    .ready.then(() =>
      raiz.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${radio}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: 620,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          pseudoElement: '::view-transition-new(root)',
        }
      )
    )
    .catch(() => {});
});
etiquetarTema();

/* Menú de pantallas angostas. */
function abrirMenu(abierto) {
  navegacion.classList.toggle('esta-abierta', abierto);
  botonMenu.setAttribute('aria-expanded', String(abierto));
  botonMenu.setAttribute('aria-label', abierto ? 'Cerrar menú' : 'Abrir menú');
}
botonMenu.addEventListener('click', () =>
  abrirMenu(botonMenu.getAttribute('aria-expanded') !== 'true')
);
navegacion.addEventListener('keydown', (evento) => {
  if (evento.key === 'Escape') {
    abrirMenu(false);
    botonMenu.focus();
  }
});

/* Cápsula de vidrio que sigue al enlace bajo el cursor. */
function moverCapsula(enlace) {
  navegacion.style.setProperty('--ancho', `${enlace?.offsetWidth || 0}px`);
  navegacion.style.setProperty('--x', `${enlace?.offsetLeft || 0}px`);
}
navegacion.addEventListener('pointerover', (evento) =>
  moverCapsula(evento.target.closest('a'))
);
navegacion.addEventListener('pointerleave', () => moverCapsula(null));

document.getElementById('anio').textContent = String(new Date().getFullYear());

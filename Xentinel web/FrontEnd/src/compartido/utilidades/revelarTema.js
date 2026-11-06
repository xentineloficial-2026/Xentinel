/** Cambia el tema revelándolo en círculo desde el clic. Sin View Transitions, o con movimiento reducido, cambia directo. */
import { flushSync } from 'react-dom';

export function alternarConRevelado(evento, alternarTema) {
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
  const transicion = document.startViewTransition(() =>
    flushSync(alternarTema)
  );
  transicion.ready
    .then(() =>
      document.documentElement.animate(
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
}

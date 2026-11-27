/** Tonos cortos del punto de control con Web Audio, sin archivos. Se distinguen sin mirar:
 * la entrada sube, la salida baja, el aviso es una nota sostenida y el rechazo es grave. */
const NOTAS = {
  entrada: [
    [660, 0, 0.12],
    [990, 0.13, 0.18],
  ],
  salida: [
    [880, 0, 0.12],
    [587, 0.13, 0.18],
  ],
  aviso: [
    [740, 0, 0.16],
    [740, 0.22, 0.16],
  ],
  error: [
    [196, 0, 0.22],
    [165, 0.26, 0.32],
  ],
};
const VIBRACION = {
  entrada: [120],
  salida: [60, 80, 60],
  aviso: [180, 100, 180],
  error: [450],
};
let contexto;

export function tocarTono(tipo) {
  const notas = NOTAS[tipo];
  if (!notas) return;
  try {
    navigator.vibrate?.(VIBRACION[tipo]);
  } catch {
    /* Sin vibración en este equipo. */
  }
  const Contexto = window.AudioContext || window.webkitAudioContext;
  if (!Contexto) return;
  try {
    contexto ||= new Contexto();
    contexto.resume().catch(() => {});
    const inicio = contexto.currentTime + 0.01;
    for (const [frecuencia, desfase, duracion] of notas) {
      const oscilador = contexto.createOscillator();
      const volumen = contexto.createGain();
      oscilador.type = tipo === 'error' ? 'square' : 'sine';
      oscilador.frequency.setValueAtTime(frecuencia, inicio + desfase);
      volumen.gain.setValueAtTime(0.0001, inicio + desfase);
      volumen.gain.exponentialRampToValueAtTime(
        tipo === 'error' ? 0.08 : 0.22,
        inicio + desfase + 0.02
      );
      volumen.gain.exponentialRampToValueAtTime(
        0.0001,
        inicio + desfase + duracion
      );
      oscilador.connect(volumen).connect(contexto.destination);
      oscilador.start(inicio + desfase);
      oscilador.stop(inicio + desfase + duracion + 0.02);
    }
  } catch {
    /* Sin audio: el resultado sigue visible en pantalla. */
  }
}

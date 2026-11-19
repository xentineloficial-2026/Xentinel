/** Sirena breve con Web Audio, sin archivos: el tono sube y baja como una alerta de emergencia. */
export function sonarSirena(segundos = 6) {
  const Contexto = window.AudioContext || window.webkitAudioContext;
  if (!Contexto) return () => {};
  const audio = new Contexto();
  const oscilador = audio.createOscillator();
  const volumen = audio.createGain();
  const inicio = audio.currentTime;
  for (let tiempo = 0; tiempo < segundos; tiempo += 0.6) {
    oscilador.frequency.setValueAtTime(700, inicio + tiempo);
    oscilador.frequency.linearRampToValueAtTime(1300, inicio + tiempo + 0.3);
    oscilador.frequency.linearRampToValueAtTime(700, inicio + tiempo + 0.6);
  }
  volumen.gain.setValueAtTime(0.0001, inicio);
  volumen.gain.exponentialRampToValueAtTime(0.25, inicio + 0.05);
  volumen.gain.setValueAtTime(0.25, inicio + segundos - 0.2);
  volumen.gain.exponentialRampToValueAtTime(0.0001, inicio + segundos);
  oscilador.connect(volumen).connect(audio.destination);
  oscilador.start(inicio);
  oscilador.stop(inicio + segundos);
  // Sin una interacción previa el navegador puede dejarlo en pausa; el aviso visual sigue.
  audio.resume().catch(() => {});
  return () => {
    try {
      oscilador.stop();
    } catch {
      /* Ya terminó. */
    }
    audio.close().catch(() => {});
  };
}

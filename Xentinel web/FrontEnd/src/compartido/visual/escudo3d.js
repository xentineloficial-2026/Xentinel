/** Escena WebGL de la portada: el logo extruido en metal; con el scroll la llave sube y el candado abre. */
import {
  ACESFilmicToneMapping,
  CatmullRomCurve3,
  Color,
  DirectionalLight,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Path,
  PerspectiveCamera,
  PMREMGenerator,
  PointLight,
  Scene,
  Shape,
  SRGBColorSpace,
  TubeGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/* Los trazos usan las coordenadas del logo; X e Y los centran e invierten el eje vertical. */
const X = (x) => x - 302;
const Y = (y) => 253 - y;
const OBJETO_ALTO = 390;
const OBJETO_ANCHO = 345;

function trazarContorno(ruta, x, y, tramos) {
  ruta.moveTo(X(x), Y(y));
  let actualX = x;
  let actualY = y;
  for (const [a, b, c, d, e, f] of tramos) {
    ruta.bezierCurveTo(
      X(actualX + a),
      Y(actualY + b),
      X(actualX + c),
      Y(actualY + d),
      X(actualX + e),
      Y(actualY + f)
    );
    actualX += e;
    actualY += f;
  }
  ruta.closePath();
}

function formaMarco() {
  const forma = new Shape();
  trazarContorno(forma, 302, 63, [
    [43, 37, 108, 65, 170, 74],
    [6, 133, -52, 248, -170, 306],
    [-118, -58, -177, -173, -171, -306],
    [62, -9, 127, -37, 171, -74],
  ]);
  const hueco = new Path();
  trazarContorno(hueco, 302, 93, [
    [-43, 33, -98, 57, -147, 64],
    [-3, 108, 49, 203, 147, 259],
    [98, -56, 150, -151, 147, -259],
    [-49, -7, -104, -31, -147, -64],
  ]);
  forma.holes.push(hueco);
  return forma;
}

function formaCuerpo() {
  const forma = new Shape();
  const [izq, der, arr, aba, r] = [240, 362, 217, 310, 12];
  forma.moveTo(X(izq + r), Y(arr));
  forma.lineTo(X(der - r), Y(arr));
  forma.quadraticCurveTo(X(der), Y(arr), X(der), Y(arr + r));
  forma.lineTo(X(der), Y(aba - r));
  forma.quadraticCurveTo(X(der), Y(aba), X(der - r), Y(aba));
  forma.lineTo(X(izq + r), Y(aba));
  forma.quadraticCurveTo(X(izq), Y(aba), X(izq), Y(aba - r));
  forma.lineTo(X(izq), Y(arr + r));
  forma.quadraticCurveTo(X(izq), Y(arr), X(izq + r), Y(arr));
  const cerradura = new Path();
  cerradura.moveTo(X(294), Y(262));
  cerradura.absarc(X(301), Y(250), 14, -2.1, -1.04, true);
  cerradura.lineTo(X(312), Y(286));
  cerradura.lineTo(X(290), Y(286));
  cerradura.closePath();
  forma.holes.push(cerradura);
  return forma;
}

function formaLlave() {
  const puntos = [
    [283, 306],
    [310, 306],
    [310, 316],
    [327, 320],
    [327, 330],
    [314, 334],
    [314, 340],
    [322, 342],
    [322, 351],
    [310, 355],
    [310, 368],
    [298, 381],
    [283, 365],
  ];
  const forma = new Shape();
  puntos.forEach(([x, y], i) =>
    i ? forma.lineTo(X(x), Y(y)) : forma.moveTo(X(x), Y(y))
  );
  forma.closePath();
  return forma;
}

function extruir(forma, profundidad, bisel, material) {
  const geometria = new ExtrudeGeometry(forma, {
    depth: profundidad,
    bevelEnabled: true,
    bevelSize: bisel,
    bevelThickness: bisel,
    bevelSegments: 4,
    curveSegments: 32,
  });
  geometria.translate(0, 0, -profundidad / 2);
  return new Mesh(geometria, material);
}

/* Tramo de p entre a y b, suavizado para que cada pieza entre y salga sin golpes. */
const tramo = (p, a, b) => {
  const t = Math.min(1, Math.max(0, (p - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mezclar = (a, b, t) => a + (b - a) * t;

export function crearEscenaEscudo(contenedor, { movimientoReducido = false } = {}) {
  const renderizador = new WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderizador.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderizador.outputColorSpace = SRGBColorSpace;
  renderizador.toneMapping = ACESFilmicToneMapping;
  renderizador.toneMappingExposure = 1.05;
  renderizador.domElement.setAttribute('aria-hidden', 'true');
  contenedor.append(renderizador.domElement);

  const escena = new Scene();
  const generador = new PMREMGenerator(renderizador);
  const entorno = new RoomEnvironment();
  const reflejos = generador.fromScene(entorno, 0.04);
  escena.environment = reflejos.texture;
  escena.environmentIntensity = 0.62;

  const camara = new PerspectiveCamera(28, 1, 10, 6000);
  const luzPrincipal = new DirectionalLight(0xdfe7e8, 2.2);
  luzPrincipal.position.set(-300, 500, 700);
  const luzContra = new DirectionalLight(0x6f8fa3, 1.6);
  luzContra.position.set(500, -200, -300);
  const luzAcceso = new PointLight(new Color('#8fc3a8'), 0, 1400, 1.4);
  luzAcceso.position.set(0, -40, 280);
  escena.add(luzPrincipal, luzContra, luzAcceso);

  const metal = new MeshStandardMaterial({
    color: 0xccd0cf,
    metalness: 1,
    roughness: 0.3,
  });
  const pulido = new MeshStandardMaterial({
    color: 0xe6eaea,
    metalness: 1,
    roughness: 0.17,
  });
  const marco = extruir(formaMarco(), 34, 5, metal);
  const cuerpo = extruir(formaCuerpo(), 46, 4, metal);
  const llave = extruir(formaLlave(), 13, 2, pulido);
  const curva = new CatmullRomCurve3(
    [
      [272, 262],
      [272, 190],
      [276, 170],
      [288, 159],
      [304, 156],
      [320, 159],
      [333, 172],
      [338, 196],
    ].map(([x, y]) => new Vector3(X(x), Y(y), 0)),
    false,
    'catmullrom',
    0.3
  );
  const grillete = new Mesh(new TubeGeometry(curva, 90, 9.5, 18), pulido);
  const grupo = new Group();
  grupo.add(marco, cuerpo, llave, grillete);
  escena.add(grupo);

  const ajustar = () => {
    const ancho = contenedor.clientWidth || 1;
    const alto = contenedor.clientHeight || 1;
    renderizador.setSize(ancho, alto);
    camara.aspect = ancho / alto;
    const tan = Math.tan((camara.fov * Math.PI) / 360);
    /* Ocupa el 66% del alto y nunca más del 76% del ancho en pantallas angostas. */
    camara.position.z = Math.max(
      OBJETO_ALTO / 0.66 / (2 * tan),
      OBJETO_ANCHO / 0.76 / (2 * tan * camara.aspect)
    );
    camara.updateProjectionMatrix();
    dibujarPendiente = true;
  };

  let objetivo = movimientoReducido ? 1 : 0;
  let progreso = objetivo;
  let cursorX = 0;
  let cursorY = 0;
  let suaveX = 0;
  let suaveY = 0;
  let visible = true;
  let cuadro = 0;
  let dibujarPendiente = true;
  const inicio = performance.now();

  const posar = (tiempo) => {
    const subeLlave = tramo(progreso, 0.04, 0.46);
    /* Fuera de cuadro no se dibuja: en pantallas altas asomaría sobre los botones. */
    llave.visible = subeLlave > 0.002;
    llave.position.set(0, mezclar(-310, 0, subeLlave), mezclar(150, 0, subeLlave));
    llave.rotation.y = mezclar(Math.PI * 1.5, 0, subeLlave);
    const abre = tramo(progreso, 0.46, 0.66);
    /* Con el candado cerrado el grillete baja; abierto coincide con el logo oficial. */
    grillete.position.y = mezclar(-28, 0, abre);
    cuerpo.position.y = Math.sin(abre * Math.PI) * -3;
    luzAcceso.intensity = tramo(progreso, 0.5, 0.72) * 900000 * 0.0028;
    const giro = tramo(progreso, 0, 0.9);
    const calma = movimientoReducido ? 0 : Math.sin(tiempo / 2400) * 0.05;
    grupo.rotation.y = mezclar(-0.68, 0, giro) + calma + suaveX * 0.24;
    grupo.rotation.x = mezclar(0.18, 0, giro) + suaveY * 0.12;
    /* El escudo cede espacio al texto: a un lado en pantallas anchas, arriba en las angostas. */
    const aparta = tramo(progreso, 0.1, 0.28) - 2 * tramo(progreso, 0.44, 0.64);
    const ancha = camara.aspect > 1.15;
    grupo.position.x = ancha ? aparta * 210 : 0;
    grupo.position.y =
      (movimientoReducido ? 0 : Math.sin(tiempo / 1900) * 5) +
      (ancha ? 0 : tramo(progreso, 0.1, 0.28) * 70);
  };

  const animar = (ahora) => {
    cuadro = 0;
    if (!visible || document.hidden) return;
    progreso += (objetivo - progreso) * 0.11;
    suaveX += (cursorX - suaveX) * 0.06;
    suaveY += (cursorY - suaveY) * 0.06;
    posar(ahora - inicio);
    renderizador.render(escena, camara);
    dibujarPendiente = false;
    if (!movimientoReducido) cuadro = requestAnimationFrame(animar);
  };
  const reanudar = () => {
    if (!cuadro && visible && !document.hidden)
      cuadro = requestAnimationFrame(animar);
  };

  const alMover = (evento) => {
    cursorX = (evento.clientX / window.innerWidth) * 2 - 1;
    cursorY = (evento.clientY / window.innerHeight) * 2 - 1;
  };
  const observador = new IntersectionObserver(([entrada]) => {
    visible = entrada.isIntersecting;
    reanudar();
  });
  const medidor = new ResizeObserver(() => {
    ajustar();
    reanudar();
  });
  observador.observe(contenedor);
  medidor.observe(contenedor);
  window.addEventListener('pointermove', alMover, { passive: true });
  document.addEventListener('visibilitychange', reanudar);
  ajustar();
  reanudar();

  return {
    fijarProgreso(valor) {
      if (movimientoReducido) return;
      objetivo = valor;
    },
    liberar() {
      cancelAnimationFrame(cuadro);
      observador.disconnect();
      medidor.disconnect();
      window.removeEventListener('pointermove', alMover);
      document.removeEventListener('visibilitychange', reanudar);
      grupo.traverse((objeto) => objeto.geometry?.dispose());
      metal.dispose();
      pulido.dispose();
      reflejos.dispose();
      generador.dispose();
      entorno.dispose?.();
      renderizador.dispose();
      renderizador.domElement.remove();
    },
    get pendiente() {
      return dibujarPendiente;
    },
  };
}

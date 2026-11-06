/** Fondo de facetas oscuras en WebGL: el material sobre el que se ve el vidrio del login y del panel. */
import {
  AmbientLight,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';

const PALETAS = {
  dark: { facetas: 0x1d3442, ambiente: 0.5, foco: 0x9bb6c4, luz: 2.6 },
  light: { facetas: 0xe3e8e8, ambiente: 1.6, foco: 0xffffff, luz: 1.1 },
};

/* Generador repetible: el fondo es el mismo en cada visita. */
function aleatorio(semilla) {
  let valor = semilla;
  return () => {
    valor = (valor * 16807) % 2147483647;
    return (valor - 1) / 2147483646;
  };
}

function crearFacetas() {
  const azar = aleatorio(4021);
  const geometria = new PlaneGeometry(46, 30, 34, 22);
  const posiciones = geometria.attributes.position;
  for (let i = 0; i < posiciones.count; i += 1) {
    posiciones.setXYZ(
      i,
      posiciones.getX(i) + (azar() - 0.5) * 0.85,
      posiciones.getY(i) + (azar() - 0.5) * 0.85,
      (azar() - 0.5) * 1.9
    );
  }
  const facetada = geometria.toNonIndexed();
  geometria.dispose();
  facetada.computeVertexNormals();
  return facetada;
}

export function crearFondoFacetas(contenedor, { estatico = false, tema = 'dark' }) {
  const renderizador = new WebGLRenderer({ antialias: true, alpha: true });
  renderizador.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderizador.outputColorSpace = SRGBColorSpace;
  renderizador.domElement.setAttribute('aria-hidden', 'true');
  contenedor.append(renderizador.domElement);

  const escena = new Scene();
  const camara = new PerspectiveCamera(42, 1, 0.1, 60);
  camara.position.z = 13;
  const material = new MeshStandardMaterial({
    flatShading: true,
    metalness: 0.55,
    roughness: 0.52,
  });
  const malla = new Mesh(crearFacetas(), material);
  malla.rotation.z = -0.32;
  const ambiente = new AmbientLight(0xffffff, 0.5);
  const lateral = new DirectionalLight(0xffffff, 1);
  lateral.position.set(-6, 8, 7);
  const foco = new PointLight(0xffffff, 40, 26, 1.5);
  foco.position.set(5, 2, 5);
  escena.add(malla, ambiente, lateral, foco);

  let cuadro = 0;
  let visible = true;
  let destinoX = 5;
  let destinoY = 2;

  const dibujar = () => renderizador.render(escena, camara);
  const animar = () => {
    cuadro = 0;
    foco.position.x += (destinoX - foco.position.x) * 0.05;
    foco.position.y += (destinoY - foco.position.y) * 0.05;
    dibujar();
    if (
      visible &&
      !document.hidden &&
      (Math.abs(destinoX - foco.position.x) > 0.01 ||
        Math.abs(destinoY - foco.position.y) > 0.01)
    )
      cuadro = requestAnimationFrame(animar);
  };
  const pedirCuadro = () => {
    if (!cuadro) cuadro = requestAnimationFrame(animar);
  };
  const ajustar = () => {
    const ancho = contenedor.clientWidth || 1;
    const alto = contenedor.clientHeight || 1;
    renderizador.setSize(ancho, alto);
    camara.aspect = ancho / alto;
    camara.updateProjectionMatrix();
    dibujar();
  };
  const fijarTema = (nombre) => {
    const paleta = PALETAS[nombre] || PALETAS.dark;
    material.color.setHex(paleta.facetas);
    ambiente.intensity = paleta.ambiente;
    lateral.intensity = paleta.luz;
    foco.color.setHex(paleta.foco);
    dibujar();
  };
  const alMover = (evento) => {
    const caja = contenedor.getBoundingClientRect();
    destinoX = ((evento.clientX - caja.left) / caja.width - 0.5) * 18;
    destinoY = -((evento.clientY - caja.top) / caja.height - 0.5) * 12;
    pedirCuadro();
  };
  const medidor = new ResizeObserver(ajustar);
  const observador = new IntersectionObserver(([entrada]) => {
    visible = entrada.isIntersecting;
  });
  medidor.observe(contenedor);
  observador.observe(contenedor);
  /* En el panel es una imagen quieta: nada se mueve detrás de los datos. */
  if (!estatico) window.addEventListener('pointermove', alMover, { passive: true });
  ajustar();
  fijarTema(tema);

  return {
    fijarTema,
    liberar() {
      cancelAnimationFrame(cuadro);
      medidor.disconnect();
      observador.disconnect();
      window.removeEventListener('pointermove', alMover);
      malla.geometry.dispose();
      material.dispose();
      renderizador.dispose();
      renderizador.domElement.remove();
    },
  };
}

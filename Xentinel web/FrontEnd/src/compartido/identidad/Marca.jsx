/** Marca Xentinel: la X oficial en la web; el escudo se conserva solo como respaldo del 3D. */
import { useId as useIdentificador } from 'react';
import { Link as Enlace } from 'react-router-dom';

/** Logo oficial (X). Toma el color del texto para funcionar en ambos temas. */
export function SimboloXentinel({ className }) {
  const mascara = `xn-x-${useIdentificador().replace(/:/g, '')}`;
  return (
    <svg className={className} viewBox="0 0 1018 1106" aria-hidden="true">
      <defs>
        <mask id={mascara}>
          <image href="/simbolo-x.png" width="1018" height="1106" />
        </mask>
      </defs>
      <rect
        width="1018"
        height="1106"
        fill="currentColor"
        mask={`url(#${mascara})`}
      />
    </svg>
  );
}

/** Escudo con candado: respaldo del escudo 3D cuando el navegador no tiene WebGL. */
export function EscudoXentinel({ className }) {
  return (
    <svg
      className={className}
      viewBox="118 50 368 406"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M302 63c43 37 108 65 170 74 6 133-52 248-170 306-118-58-177-173-171-306 62-9 127-37 171-74Zm0 30c-43 33-98 57-147 64-3 108 49 203 147 259 98-56 150-151 147-259-49-7-104-31-147-64Z"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="19"
        strokeLinecap="round"
        d="M272 224v-34c0-22 15-34 32-34 18 0 32 14 34 40"
      />
      <path
        fillRule="evenodd"
        d="M252 217h98a12 12 0 0 1 12 12v69a12 12 0 0 1-12 12h-98a12 12 0 0 1-12-12v-69a12 12 0 0 1 12-12Zm49 19a14 14 0 0 0-7 26l-4 24h22l-4-24a14 14 0 0 0-7-26Z"
      />
      <path d="M283 306h27v10l17 4v10l-13 4v6l8 2v9l-12 4v13l-12 13-15-16Z" />
    </svg>
  );
}

/** grande selecciona la composición amplia utilizada en el pie de página. */
export function Marca({ grande = false }) {
  return (
    <Enlace
      to="/"
      className={`xn-marca${grande ? ' xn-marca--grande' : ''}`}
      aria-label="Xentinel, inicio"
    >
      <SimboloXentinel />
      <span>Xentinel</span>
    </Enlace>
  );
}

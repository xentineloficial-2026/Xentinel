/** Motivo de marca: el contorno del escudo repetido hacia afuera, como un perímetro que se extiende. */
const ESCUDO =
  'M0-190c43 37 108 65 170 74 6 133-52 248-170 306-118-58-177-173-171-306 62-9 127-37 171-74Z';
const ESCALAS = [1, 1.45, 1.95, 2.5, 3.1, 3.75, 4.45, 5.2];

export function Perimetro({ className = '' }) {
  return (
    <svg
      className={`xn-perimetro ${className}`}
      viewBox="-800 -800 1600 1600"
      preserveAspectRatio="xMidYMid slice"
      fill="none"
      aria-hidden="true"
    >
      {ESCALAS.map((escala) => (
        <path
          key={escala}
          d={ESCUDO}
          transform={`scale(${escala})`}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

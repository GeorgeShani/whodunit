/** Mystery-guest placeholder for characters whose portraits aren't drawn yet. */
export function Silhouette({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 784 1224"
      role="img"
      aria-label="Unknown suspect silhouette"
      className={className}
    >
      <g transform="translate(151 0)" fill="#140b26" stroke="#000" strokeWidth="10">
        <ellipse cx="401" cy="170" rx="95" ry="115" />
        <path d="M205 270 h90 l10 60 h-110 z" />
        <path d="M120 330 Q250 290 380 330 L400 760 Q250 800 100 760 Z" />
        <path d="M120 340 L60 700 Q70 730 100 720 L150 420 Z" />
        <path d="M380 340 L430 700 Q420 730 390 720 L350 420 Z" />
        <path d="M150 760 L165 1150 h70 L250 820 L265 1150 h70 L350 760 Z" />
        <path d="M150 1150 h100 v40 h-110 z M250 1150 h100 v40 h-100 z" />
      </g>
      <text
        x="401"
        y="215"
        textAnchor="middle"
        fontSize="170"
        fontFamily="var(--font-bangers), Impact, sans-serif"
        fill="#ffcf33"
        stroke="#000"
        strokeWidth="8"
        paintOrder="stroke"
      >
        ?
      </text>
    </svg>
  );
}

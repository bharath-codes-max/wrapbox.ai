/** Glycon's dot mark, rebuilt as SVG from the supplied logo: a four-column staircase
 *  of 26px dots (33px pitch across, 31.5px down), one green per column. */
const COLS: { fill: string; rows: number[] }[] = [
  { fill: "#53f73c", rows: [2] },
  { fill: "#26d113", rows: [1, 2] },
  { fill: "#25b711", rows: [0, 1, 2] },
  { fill: "#008218", rows: [0, 1, 2] },
];

export function GlyconMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size * (89 / 125)} viewBox="0 0 125 89" aria-hidden="true" focusable="false">
      {COLS.flatMap((c, ci) => c.rows.map((r) => <circle key={`${ci}-${r}`} cx={13 + ci * 33} cy={13 + r * 31.5} r={13} fill={c.fill} />))}
    </svg>
  );
}

/** The workspace's mark: Glycon's logo for the demo company, initials for a fresh one. */
export function CompanyMark({ demo, name, size = 26 }: { demo: boolean; name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "W";
  return (
    <span className={`company-mark${demo ? " is-logo" : ""}`} style={{ width: size, height: size }}>
      {demo ? <GlyconMark size={Math.round(size * 0.72)} /> : <span className="company-initials">{initials}</span>}
    </span>
  );
}

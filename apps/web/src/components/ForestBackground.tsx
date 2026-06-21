const leaves = [
  ["12%", "1.2s", "14s", "10px"],
  ["38%", "4.4s", "16s", "9px"],
  ["64%", "2.8s", "15s", "11px"],
  ["88%", "5.1s", "17s", "9px"],
] as const;

export function ForestBackground() {
  return (
    <div className="forest" aria-hidden="true">
      <div className="forest__light" />
      <div className="forest__cloud forest__cloud--one" />
      <div className="forest__cloud forest__cloud--two" />
      <div className="forest__branch forest__branch--left" />
      <div className="forest__branch forest__branch--right" />
      <div className="forest__particles" />
      {leaves.map(([left, delay, duration, size], index) => (
        <i
          className="forest__leaf"
          key={`${left}-${index}`}
          style={
            {
              "--leaf-left": left,
              "--leaf-delay": delay,
              "--leaf-duration": duration,
              "--leaf-size": size,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

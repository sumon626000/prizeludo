export function GameSceneBackdrop() {
  return (
    <div className="game-scene-backdrop" aria-hidden="true">
      <div className="game-scene-backdrop__glow game-scene-backdrop__glow--top" />
      <div className="game-scene-backdrop__glow game-scene-backdrop__glow--board" />
      <div className="game-scene-backdrop__grid" />
    </div>
  );
}

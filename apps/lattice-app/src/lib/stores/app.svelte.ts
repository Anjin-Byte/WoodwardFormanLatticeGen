// Reactive app state using Svelte 5 runes
let sceneReady = $state(false);

export function getSceneReady(): boolean {
  return sceneReady;
}

export function setSceneReady(value: boolean): void {
  sceneReady = value;
}

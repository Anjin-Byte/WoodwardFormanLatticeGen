// Stub for @gestalt/phi's $lib/stores/status dependency.
// Plain .ts — no runes. phi components import setHint/clearHint from here.

let currentHint = '';

export function setHint(text: string): void {
  currentHint = text;
}

export function clearHint(): void {
  currentHint = '';
}

export function getHint(): string {
  return currentHint;
}

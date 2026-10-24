// Only navigation metadata; never content or credentials.
let origin = '';
export function rememberReadingOrigin(view: string) {
  if (!document.querySelector('.reading-surface') && !origin) origin = view;
}
export function returnReadingOrigin() {
  if (origin) {
    window.dispatchEvent(new CustomEvent('pk-reading-return', { detail: origin }));
    origin = '';
  }
}
export function clearReadingOrigin() {
  origin = '';
}

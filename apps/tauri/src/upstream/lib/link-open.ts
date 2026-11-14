// frowd owns host actions. No SoloMD workspace/files/sync store is initialized.
export function openRenderedLink(anchor: Element, event: Event, _path?: string|null): boolean {
  const href = anchor.getAttribute('href') || anchor.getAttribute('xlink:href');
  if(!href) return false;
  const mouse = event as MouseEvent;
  event.preventDefault();
  if(mouse.ctrlKey || mouse.metaKey) {
    event.stopPropagation();
    window.dispatchEvent(new CustomEvent('frowd:open-link', { detail: { href } }));
    return true;
  }
  return false;
}

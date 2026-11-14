// frowd host boundary replacing SoloMD's unrestricted convertFileSrc path.
// Until document-scoped resource commands land, only embedded raster data is rendered.
const embedded = (src: string) => /^data:image\/(png|jpeg|gif|webp);base64,/i.test(src) ? src : '';
export function resolveImagePath(src: string, _root?: string|null, _path?: string): string { return embedded(src); }
export function resolveImageSrc(src: string, _root?: string|null, _path?: string): string { return embedded(src); }
export function isLocalSvgPath(_src: string): boolean { return false; }
export function installSvgImageFallbacks(_root: ParentNode): void {}
export function rewriteImageUrls(html: string, _root?: string|null, _path?: string): string {
  const template = document.createElement('template'); template.innerHTML = html;
  template.content.querySelectorAll('img').forEach(img => {
    const safe = embedded(img.getAttribute('src') || '');
    if(safe) img.setAttribute('src', safe);
    else { img.removeAttribute('src'); img.setAttribute('alt', (img.getAttribute('alt') || '') + ' [图片暂不可用]'); }
    img.removeAttribute('srcset');
  });
  return template.innerHTML;
}

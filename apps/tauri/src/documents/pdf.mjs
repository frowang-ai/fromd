import { buildPdfDocument } from '@frowang/editor/pdf';
import { renderMarkdown } from '@frowang/editor/markdown';
import katexCss from '../../../../node_modules/katex/dist/katex.min.css?raw';

// Vite embeds the same locked fonts used by the editor. The print webview never
// acquires a filesystem or HTTP font URL.
const fonts = import.meta.glob('../../../../node_modules/katex/dist/fonts/*.woff2', {
  query: '?inline', import: 'default', eager: true,
});
const printMathCss = katexCss.replace(/src:[^;}]+/g, declaration => {
  const name = declaration.match(/fonts\/([^)'"\s]+\.woff2)/)?.[1];
  const data = fonts['../../../../node_modules/katex/dist/fonts/' + name];
  if (!data?.startsWith('data:')) throw Error('公式字体未打包，请重新构建应用。');
  return `src:url("${data}") format("woff2")`;
});

export async function preparePdfDocument(snapshot, readImages) {
  const fragment = document.createElement('template');
  fragment.innerHTML = renderMarkdown(snapshot.markdown);
  const references = [...new Set([...fragment.content.querySelectorAll('img')].map(image => image.getAttribute('src')))];
  // Native preparation distinguishes transient base64 rasters from docId-scoped
  // file references, validates both, and applies their combined export budget.
  const images = await readImages(snapshot.id, snapshot.revision, references);
  const html = await buildPdfDocument({
    markdown: snapshot.markdown, title: snapshot.title, pageLayout: 'native',
    resolveImage: reference => images[reference] ?? null,
  });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const style = doc.createElement('style');
  style.textContent = printMathCss;
  doc.head.append(style);
  return '<!doctype html>' + doc.documentElement.outerHTML;
}

import { buildPdfDocument } from '@frowang/editor/pdf';
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
  const html = await buildPdfDocument({
    markdown: snapshot.markdown, title: snapshot.title, pageLayout: 'native',
    resolveImages: references => readImages(snapshot.id, snapshot.revision, references),
  });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const style = doc.createElement('style');
  style.textContent = printMathCss;
  doc.head.append(style);
  return '<!doctype html>' + doc.documentElement.outerHTML;
}

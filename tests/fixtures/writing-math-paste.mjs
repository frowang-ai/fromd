// Synthetic clipboard source: no real notes or system clipboard access.
export const mathPasteValues = {
  base: String.raw`\mathcal{Q}_{\text{base}}`,
  model: String.raw`\mathcal{Q}_{\text{model}}`,
  noise: String.raw`\mathcal{Q}_{\text{noise}}`,
  fraction: String.raw`\frac{\mathcal{Q}_{\text{base}}-\mathcal{Q}_{\text{model}}}{\mathcal{Q}_{\text{base}}-\mathcal{Q}_{\text{noise}}}`,
}
export const mathPasteMarkdown = `比较三种误差。\n\n**基准 $${mathPasteValues.base}$ 与模型 $${mathPasteValues.model}$ 的差异。**\n\n不可约部分为 $${mathPasteValues.noise}$。\n\n$$\n${mathPasteValues.fraction}\n$$\n\n**保留思考时间。**`
export function mathPasteHtml(renderMath) {
  return `<p>比较三种误差。</p><p><strong>基准 ${renderMath(mathPasteValues.base)} 与模型 ${renderMath(mathPasteValues.model)} 的差异。</strong></p><p>不可约部分为 ${renderMath(mathPasteValues.noise)}。</p>${renderMath(mathPasteValues.fraction, true)}<p><strong>保留思考时间。</strong></p>`
}

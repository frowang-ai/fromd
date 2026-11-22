import katex from 'katex'

// Render states only; source, selection and history remain owned by the node view.
export function renderMathPreview(element, value, { displayMode = false } = {}) {
  element.classList.remove('is-empty', 'is-incomplete')
  const placeholder = (text, state) => {
    const label = element.ownerDocument.createElement('span')
    label.className = 'writing-math-placeholder'
    label.textContent = text
    element.replaceChildren(label)
    element.classList.add(state)
  }
  if (!value.trim()) {
    placeholder(displayMode ? '〈空公式块〉' : '〈空公式〉', 'is-empty')
    return
  }
  try { katex.render(value, element, { displayMode, throwOnError: true, trust: false }) }
  catch { placeholder('公式尚未完整', 'is-incomplete') }
}

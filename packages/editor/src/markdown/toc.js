/**
 * 从渲染后的 Markdown HTML 提取标题目录，并提供滚动跳转。
 */

/**
 * 从 Markdown HTML 中提取标题，生成目录
 * @param {HTMLElement} container - 包含渲染后 HTML 的容器元素
 * @returns {Array} 目录项数组
 */
export function extractTOC(container) {
  if (!container) return []

  const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6')
  const toc = []

  headings.forEach((heading, index) => {
    const level = parseInt(heading.tagName.substring(1))
    const text = heading.textContent || ''
    const id = `heading-${index}`

    // 为标题添加 ID，方便跳转
    heading.id = id

    toc.push({
      id,
      level,
      text,
      children: []
    })
  })

  return buildTOCTree(toc)
}

/**
 * 构建目录树结构
 * @param {Array} flatTOC - 扁平的目录数组
 * @returns {Array} 树形目录结构
 */
function buildTOCTree(flatTOC) {
  if (flatTOC.length === 0) return []

  const tree = []
  const stack = []

  flatTOC.forEach(item => {
    const newItem = { ...item, children: [] }

    // 找到合适的父节点
    while (stack.length > 0 && stack[stack.length - 1].level >= newItem.level) {
      stack.pop()
    }

    if (stack.length === 0) {
      tree.push(newItem)
    } else {
      stack[stack.length - 1].children.push(newItem)
    }

    stack.push(newItem)
  })

  return tree
}

/**
 * 滚动到指定标题
 * @param {string} headingId - 标题 ID
 */
export function scrollToHeading(headingId) {
  const element = document.getElementById(headingId)
  if (element) {
    const headerHeight = 80 // 考虑固定头部的高度
    const elementPosition = element.getBoundingClientRect().top + window.pageYOffset
    const offsetPosition = elementPosition - headerHeight

    window.scrollTo({
      top: offsetPosition,
      behavior: 'smooth'
    })
  }
}

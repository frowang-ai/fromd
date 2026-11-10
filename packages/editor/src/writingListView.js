// Keep the list item content DOM mounted synchronously. Crepe's Vue list view
// restores mount-time selections on a later frame, which can overwrite a newer
// arrow/click immediately after an indent/outdent. ProseMirror owns selection.
export function installWritingListViews(view) {
  view.setProps({ nodeViews: {
    ...view.props.nodeViews,
    list_item(initial, editor, getPos) {
      let node = initial
      const dom = document.createElement('div'); dom.className = 'milkdown-list-item-block'
      const item = document.createElement('li'); item.className = 'list-item'
      const marker = document.createElement('div'); marker.className = 'label-wrapper'; marker.contentEditable = 'false'
      const label = document.createElement('span')
      const children = document.createElement('div'); children.className = 'children'
      const contentDOM = document.createElement('div'); contentDOM.className = 'content-dom'; contentDOM.dataset.contentDom = 'true'
      marker.append(label); children.append(contentDOM); item.append(marker, children); dom.append(item)
      function render() {
        const { checked, listType } = node.attrs
        label.className = `label ${checked == null ? (listType === 'bullet' ? 'bullet' : 'ordered') : checked ? 'checked' : 'unchecked'}`
        label.textContent = checked == null && listType !== 'bullet' ? String(node.attrs.label || '') : ''
        if (checked == null) {
          label.removeAttribute('role'); label.removeAttribute('tabindex'); label.removeAttribute('aria-checked'); label.removeAttribute('aria-label')
        } else {
          label.setAttribute('role', 'checkbox'); label.tabIndex = editor.editable ? 0 : -1
          label.setAttribute('aria-checked', String(checked)); label.setAttribute('aria-label', checked ? '标为未完成' : '标为已完成')
        }
      }
      function toggle() {
        if (node.attrs.checked == null || !editor.editable) return
        const pos = getPos()
        if (typeof pos === 'number') editor.dispatch(editor.state.tr.setNodeAttribute(pos, 'checked', !node.attrs.checked))
      }
      marker.addEventListener('pointerdown', event => { if (node.attrs.checked != null) event.preventDefault() })
      marker.addEventListener('click', event => { if (node.attrs.checked != null) { event.preventDefault(); toggle() } })
      marker.addEventListener('keydown', event => {
        if (node.attrs.checked != null && [' ', 'Enter'].includes(event.key)) { event.preventDefault(); toggle() }
      })
      render()
      return {
        dom, contentDOM,
        update(next) { if (next.type !== node.type) return false; node = next; render(); return true },
        stopEvent: event => node.attrs.checked != null && marker.contains(event.target),
        ignoreMutation: mutation => mutation.type !== 'selection' && (mutation.target === contentDOM && mutation.type === 'attributes' || !contentDOM.contains(mutation.target)),
        selectNode() { item.classList.add('ProseMirror-selectednode') },
        deselectNode() { item.classList.remove('ProseMirror-selectednode') },
      }
    },
  } })
}

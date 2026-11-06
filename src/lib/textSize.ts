import { Mark, mergeAttributes } from '@tiptap/core'

/** Small or large text. Normal is the absence of this mark. Heading is a separate block. */
export const TextSize = Mark.create({
  name: 'textSize',
  addAttributes() {
    return {
      size: {
        default: null,
        parseHTML: (element) => {
          const size = element.getAttribute('data-size')
          return size === 'small' || size === 'large' ? size : null
        },
        renderHTML: (attributes) => {
          if (attributes.size !== 'small' && attributes.size !== 'large') return {}
          return { 'data-size': attributes.size }
        },
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-size]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0]
  },
})

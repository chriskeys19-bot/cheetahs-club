import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useId } from 'react'
import { toEditorHtml } from '../lib/richText.ts'
import { TextSize } from '../lib/textSize.ts'

const extensions = [
  StarterKit.configure({
    heading: { levels: [2] },
    blockquote: false,
    code: false,
    codeBlock: false,
    horizontalRule: false,
    italic: false,
    link: false,
    strike: false,
    underline: false,
  }),
  TextSize,
]

type SizeName = 'small' | 'normal' | 'large' | 'heading'

export function RichTextField({
  label,
  initial,
  onChange,
  compact = false,
  required = false,
}: {
  label: string
  initial: string
  onChange: (stored: string, textLength: number) => void
  compact?: boolean
  required?: boolean
}) {
  const labelId = useId()
  const editor = useEditor({
    immediatelyRender: true,
    shouldRerenderOnTransaction: true,
    extensions,
    content: toEditorHtml(initial),
    editorProps: {
      attributes: {
        'aria-labelledby': labelId,
        'aria-required': required ? 'true' : 'false',
        'aria-multiline': 'true',
        role: 'textbox',
      },
    },
    onUpdate: ({ editor: current }) => {
      const text = current.getText({ blockSeparator: '\n' }).trim()
      onChange(text.length === 0 ? '' : current.getHTML(), text.length)
    },
  })

  function applySize(size: SizeName) {
    if (!editor) return
    const chain = editor.chain().focus()
    if (size === 'heading') {
      chain.unsetMark('textSize').setHeading({ level: 2 }).run()
      return
    }
    if (editor.isActive('heading')) chain.setParagraph()
    if (size === 'normal') chain.unsetMark('textSize').run()
    else chain.setMark('textSize', { size }).run()
  }

  const activeSize: SizeName = !editor
    ? 'normal'
    : editor.isActive('heading', { level: 2 })
      ? 'heading'
      : editor.isActive('textSize', { size: 'small' })
        ? 'small'
        : editor.isActive('textSize', { size: 'large' })
          ? 'large'
          : 'normal'

  return (
    <div className={compact ? 'rte rte-compact' : 'rte'}>
      <span id={labelId} className="rte-label">
        {label}
      </span>
      <div className="rte-toolbar" role="toolbar" aria-label={`${label} formatting`}>
        <button
          type="button"
          className="rte-button"
          aria-pressed={editor?.isActive('bold') ?? false}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          Bold
        </button>
        <button
          type="button"
          className="rte-button"
          aria-pressed={editor?.isActive('bulletList') ?? false}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          Bullets
        </button>
        <button
          type="button"
          className="rte-button"
          aria-pressed={editor?.isActive('orderedList') ?? false}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        >
          Numbered
        </button>
        <div className="rte-sizes" role="group" aria-label="Text size">
          {(['small', 'normal', 'large', 'heading'] as const).map((size) => (
            <button
              key={size}
              type="button"
              className="rte-button"
              aria-pressed={activeSize === size}
              onClick={() => applySize(size)}
            >
              {size === 'small' ? 'Small' : size === 'normal' ? 'Normal' : size === 'large' ? 'Large' : 'Heading'}
            </button>
          ))}
        </div>
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}

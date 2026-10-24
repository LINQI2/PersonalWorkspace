import { useEffect, useRef, useState } from 'react';
import {
  Trash2,
  ImagePlus,
  Bold,
  Italic,
  List,
  ListOrdered,
  Link,
  Undo2,
  Redo2,
  Sparkles,
} from 'lucide-react';
import { api } from './shared';
import { useEditor, useEditorState, EditorContent, Extension } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
const EntryReference = Extension.create({
  name: 'entryReference',
  addGlobalAttributes() {
    return [
      {
        types: ['link'],
        attributes: {
          readingMark: {
            default: null,
            parseHTML: (element) =>
              /^[a-f0-9-]{36}$/.test(element.getAttribute('data-reading-mark') || '')
                ? element.getAttribute('data-reading-mark')
                : null,
            renderHTML: (attrs) =>
              attrs.readingMark ? { 'data-reading-mark': attrs.readingMark } : {},
          },
          entryId: {
            default: null,
            parseHTML: (element) =>
              /^[a-f0-9-]{36}$/.test(element.getAttribute('data-entry-id') || '')
                ? element.getAttribute('data-entry-id')
                : null,
            renderHTML: (attributes) =>
              attributes.entryId ? { 'data-entry-id': attributes.entryId } : {},
          },
        },
      },
    ];
  },
});
export function RichEditor({
  content,
  onChange,
  onError,
  onBusy,
  disabled,
  onOrganize,
  aiBusy,
}: {
  content: string;
  onChange: (s: string) => void;
  onError: (s: string) => void;
  onBusy: (s: boolean) => void;
  disabled?: boolean;
  onOrganize?: () => void;
  aiBusy?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [linkError, setLinkError] = useState('');
  const linkSelection = useRef<{ from: number; to: number } | undefined>(undefined);
  useEffect(() => onBusy(uploading), [uploading, onBusy]);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: {
          openOnClick: false,
          HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
        },
      }),
      Image.configure({ allowBase64: false }),
      EntryReference,
    ],
    content,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: { attributes: { 'aria-label': '笔记正文', class: 'prose' } },
  });
  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive('bold'),
            italic: e.isActive('italic'),
            bulletList: e.isActive('bulletList'),
            orderedList: e.isActive('orderedList'),
            link: e.isActive('link'),
            image: e.isActive('image'),
            h2: e.isActive('heading', { level: 2 }),
            h3: e.isActive('heading', { level: 3 }),
            undo: e.can().undo(),
            redo: e.can().redo(),
            text: e.getText(),
          }
        : null,
  });
  if (!editor || !state) return null;
  const actions = [
    {
      name: '段落',
      active: !state.h2 && !state.h3,
      run: () => editor.chain().focus().setParagraph().run(),
    },
    {
      name: 'H2',
      active: state.h2,
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      name: 'H3',
      active: state.h3,
      run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      name: '加粗',
      icon: Bold,
      active: state.bold,
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      name: '斜体',
      icon: Italic,
      active: state.italic,
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      name: '无序列表',
      icon: List,
      active: state.bulletList,
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      name: '有序列表',
      icon: ListOrdered,
      active: state.orderedList,
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      name: '链接',
      icon: Link,
      active: state.link,
      run: () => {
        const { from, to } = editor.state.selection;
        linkSelection.current = { from, to };
        setLinkValue(editor.getAttributes('link').href || '');
        setLinkError('');
        setLinkOpen(!linkOpen);
      },
    },
    {
      name: '撤销',
      icon: Undo2,
      disabled: !state.undo,
      run: () => editor.chain().focus().undo().run(),
    },
    {
      name: '重做',
      icon: Redo2,
      disabled: !state.redo,
      run: () => editor.chain().focus().redo().run(),
    },
  ];
  return (
    <div className="rich-editor">
      <div className="toolbar" role="toolbar" aria-label="笔记格式">
        {onOrganize && (
          <button
            type="button"
            disabled={aiBusy || disabled || uploading}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onOrganize}
            aria-label="AI 整理笔记"
            title="AI 整理笔记"
          >
            <Sparkles size={15} />
            AI 整理笔记
          </button>
        )}
        {actions.map((a) => (
          <button
            type="button"
            key={a.name}
            title={a.name}
            aria-label={a.name}
            aria-pressed={a.active}
            className={a.active ? 'selected' : ''}
            disabled={a.disabled || uploading}
            onMouseDown={(e) => e.preventDefault()}
            onClick={a.run}
          >
            {a.icon ? <a.icon size={16} /> : a.name}
          </button>
        ))}
        <label className="tool-upload" title="插入图片">
          <ImagePlus size={17} />
          <input
            aria-label="插入正文图片"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            disabled={uploading}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setUploading(true);
              try {
                const fd = new FormData();
                fd.append('image', file);
                const a = await api('/assets', { method: 'POST', body: fd });
                editor
                  .chain()
                  .focus()
                  .setImage({ src: a.url, alt: file.name.replace(/\.[^.]+$/, '') })
                  .run();
              } catch (err) {
                onError((err as Error).message);
              } finally {
                setUploading(false);
                e.target.value = '';
              }
            }}
          />
        </label>
        {state.image && (
          <button
            type="button"
            className="danger-text"
            aria-label="移除选中图片"
            onClick={() => editor.chain().focus().deleteSelection().run()}
          >
            <Trash2 size={15} />
          </button>
        )}
        {uploading && <small>图片保存中…</small>}
      </div>
      {linkOpen && (
        <div className="link-popover">
          <label>
            链接地址
            <input
              aria-label="笔记链接地址"
              type="url"
              placeholder="https://…"
              value={linkValue}
              onChange={(e) => setLinkValue(e.target.value)}
            />
          </label>
          <div>
            <button
              type="button"
              onClick={() => {
                try {
                  const url = new URL(linkValue);
                  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
                    throw Error();
                  const selection = linkSelection.current || editor.state.selection;
                  const chain = editor
                    .chain()
                    .focus()
                    .setTextSelection(selection)
                    .extendMarkRange('link');
                  if (selection.from === selection.to && !editor.isActive('link')) {
                    chain
                      .insertContent({
                        type: 'text',
                        text: linkValue,
                        marks: [{ type: 'link', attrs: { href: linkValue } }],
                      })
                      .command(({ tr }) => {
                        tr.removeStoredMark(editor.schema.marks.link);
                        return true;
                      })
                      .run();
                  } else chain.setLink({ href: linkValue }).run();
                  setLinkOpen(false);
                } catch {
                  setLinkError('请输入不含账号密码的 http/https 链接。');
                }
              }}
            >
              应用链接
            </button>
            <button
              type="button"
              onClick={() => {
                editor
                  .chain()
                  .focus()
                  .setTextSelection(linkSelection.current || editor.state.selection)
                  .extendMarkRange('link')
                  .unsetLink()
                  .run();
                setLinkOpen(false);
              }}
            >
              移除链接
            </button>
            <button type="button" onClick={() => setLinkOpen(false)}>
              取消
            </button>
          </div>
          {linkError && <p role="alert">{linkError}</p>}
        </div>
      )}
      <EditorContent editor={editor} />
      <div className="editor-hint">
        <span>图片保存在本机 · Ctrl+Z 撤销</span>
        <span>{state.text.replace(/\s/g, '').length} 字</span>
      </div>
    </div>
  );
}

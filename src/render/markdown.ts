import { toHtml } from 'hast-util-to-html'
import { toHast } from 'mdast-util-to-hast'
import type { Code, Root, RootContent } from 'mdast'
import { polarityOf } from '../plugins/rule-extract.js'
import { escapeHtml, el, text } from './html.js'

export interface MarkdownOptions {
  /** 규칙 파일 사이 링크를 렌더 결과의 확장자로 바꾼다. 기본 true. */
  rewriteLinks?: boolean
}

const POLARITY_LABEL: Record<'right' | 'wrong', string> = {
  right: '권장',
  wrong: '지양',
}

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i

/** `../naming/foo.md#anchor` 처럼 규칙 파일을 가리키는 링크를 `.html` 로 옮긴다. */
export function rewriteMarkdownLink(url: string): string {
  if (EXTERNAL.test(url)) return url
  return url.replace(/\.md(?=$|[#?])/, '.html')
}

/** mdast 를 복제하면서 링크만 바꾼다. 원본 데이터 모델은 건드리지 않는다. */
function withRewrittenLinks<T extends RootContent>(node: T): T {
  const clone = structuredClone(node)
  const visit = (n: unknown): void => {
    if (!n || typeof n !== 'object') return
    const candidate = n as { type?: string; url?: string; children?: unknown[] }
    if (
      (candidate.type === 'link' || candidate.type === 'definition') &&
      typeof candidate.url === 'string'
    ) {
      candidate.url = rewriteMarkdownLink(candidate.url)
    }
    if (Array.isArray(candidate.children)) candidate.children.forEach(visit)
  }
  visit(clone)
  return clone
}

/**
 * 코드 블록은 hast 로 넘기지 않고 직접 그린다.
 * 데이터 모델이 알고 있는 예시 극성(권장/지양)을 마크업에 남기기 위해서다.
 */
export function renderCode(node: Code): string {
  const polarity = polarityOf(node.value)
  const lang = node.lang ?? null
  const caption = [
    polarity
      ? text('span', { class: `polarity polarity--${polarity}` }, POLARITY_LABEL[polarity])
      : null,
    lang ? text('span', { class: 'lang' }, lang) : null,
  ].filter((c): c is string => c !== null)

  return el(
    'figure',
    {
      class: polarity ? `example example--${polarity}` : 'example',
      'data-polarity': polarity ?? 'none',
      'data-lang': lang,
    },
    caption.length > 0 ? el('figcaption', {}, ...caption) : '',
    el(
      'pre',
      {},
      el(
        'code',
        { class: lang ? `language-${lang}` : null },
        `${escapeHtml(node.value)}\n`,
      ),
    ),
  )
}

/** mdast 노드 하나를 HTML 로 만든다. 원시 HTML 노드는 to-hast 기본값대로 버려진다. */
function renderNode(node: RootContent, options: MarkdownOptions): string {
  const prepared = options.rewriteLinks === false ? node : withRewrittenLinks(node)
  const root: Root = { type: 'root', children: [prepared] }
  return toHtml(toHast(root))
}

/** 섹션 본문(mdast 노드 배열)을 HTML 로 만든다. */
export function renderContent(
  nodes: RootContent[],
  options: MarkdownOptions = {},
): string {
  return nodes
    .map((node) => (node.type === 'code' ? renderCode(node) : renderNode(node, options)))
    .filter((html) => html !== '')
    .join('\n')
}

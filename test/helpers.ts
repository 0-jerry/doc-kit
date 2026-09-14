import type { RootContent } from 'mdast'
import { Block, type BlockForm, Document, Section, type Child, aux } from '../src/model/index.js'
import type { Aux } from '../src/model/index.js'

export function mdast(text: string, line = 1): RootContent {
  return {
    type: 'paragraph',
    children: [{ type: 'text', value: text }],
    position: {
      start: { line, column: 1, offset: 0 },
      end: { line, column: text.length + 1, offset: text.length },
    },
  }
}

export function block(
  text: string,
  options: { form?: BlockForm; aux?: Aux; stableId?: string | null } = {},
): Block {
  return new Block({
    form: options.form ?? 'paragraph',
    text,
    source: mdast(text),
    aux: options.aux ?? aux(),
    stableId: options.stableId ?? null,
  })
}

export function section(
  key: string,
  children: readonly Child[] = [],
  options: { aux?: Aux; heading?: string; depth?: number } = {},
): Section {
  return new Section({
    key,
    heading: options.heading ?? key,
    depth: options.depth ?? 2,
    children,
    aux: options.aux ?? aux(),
  })
}

export function document(children: readonly Child[] = [], options: { aux?: Aux } = {}): Document {
  return new Document({
    id: 'principle/불변식은-생성자에서-검증한다',
    type: 'principle',
    path: 'principle/불변식은-생성자에서-검증한다.md',
    children,
    aux: options.aux ?? aux(),
  })
}

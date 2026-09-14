import path from 'node:path'
import { buildGraph, type GraphEdge, type RuleGraph } from '../graph.js'
import { buildIndex, type RuleIndex } from '../index-build.js'
import type { RelationKind, Rule, RuleSet } from '../types.js'

export interface RenderOptions {
  /** 사이트 제목. 기본 '규칙집'. */
  title?: string
  /** `<html lang>`. 기본 'ko'. */
  lang?: string
  /** 생성 시각. 고정하면 산출물이 결정론적이 된다. */
  generatedAt?: string
  /** 원문 마크다운으로 가는 링크 접두사. 예: GitHub blob URL. */
  sourceBase?: string
  /** CSS·JS 를 문서 안에 인라인한다(단일 파일 배포). 기본 false. */
  inlineAssets?: boolean
}

/** 렌더된 파일 하나. 경로는 출력 디렉터리 기준 POSIX 상대 경로다. */
export interface RenderedFile {
  path: string
  content: string
}

/** 페이지를 그리는 데 필요한 데이터 모델 전부. 렌더러는 이것만 읽는다. */
export interface SiteContext {
  options: Required<Pick<RenderOptions, 'title' | 'lang' | 'generatedAt'>> &
    RenderOptions
  index: RuleIndex
  graph: RuleGraph
  rules: Map<string, Rule>
  /** 규칙 id → 그 규칙을 가리키는 간선. '참조하는 규칙' 목록의 원천. */
  backlinks: Map<string, GraphEdge[]>
}

/** 검증된 규칙 모음에서 렌더 컨텍스트를 만든다(인덱스·그래프 포함). */
export function createContext(set: RuleSet, options: RenderOptions = {}): SiteContext {
  const index = buildIndex(set)
  const graph = buildGraph(set)
  const backlinks = new Map<string, GraphEdge[]>()
  for (const edge of graph.edges) {
    if (edge.dangling) continue
    const list = backlinks.get(edge.to) ?? []
    list.push(edge)
    backlinks.set(edge.to, list)
  }

  return {
    options: {
      ...options,
      title: options.title ?? '규칙집',
      lang: options.lang ?? 'ko',
      generatedAt: options.generatedAt ?? new Date().toISOString(),
    },
    index,
    graph,
    rules: new Map(set.rules.map((rule) => [rule.meta.id, rule])),
    backlinks,
  }
}

export const INDEX_PAGE = 'index.html'
export const STYLE_PATH = 'assets/style.css'
export const SCRIPT_PATH = 'assets/app.js'

/** 규칙 페이지 경로. 규칙 트리의 `category/id` 구조를 그대로 옮긴다. */
export const rulePath = (rule: { category: string; id: string }): string =>
  `rules/${rule.category}/${rule.id}.html`

export const categoryPath = (category: string): string =>
  `categories/${category}.html`

/** `from` 페이지에서 `to` 파일로 가는 상대 링크. */
export function href(from: string, to: string): string {
  const rel = path.posix.relative(path.posix.dirname(from), to)
  return rel === '' ? path.posix.basename(to) : rel
}

export const RELATION_LABEL: Record<RelationKind, string> = {
  extends: '확장',
  related: '관련',
  conflicts: '충돌',
  supersedes: '대체함',
  supersededBy: '대체됨',
}

export const SEVERITY_LABEL: Record<string, string> = {
  error: '오류',
  warning: '경고',
  info: '정보',
}

export const STATUS_LABEL: Record<string, string> = {
  proposed: '제안',
  active: '활성',
  deprecated: '폐기 예정',
  superseded: '대체됨',
}

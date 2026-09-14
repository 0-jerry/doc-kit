import { SCRIPT, STYLESHEET } from './assets.js'
import {
  INDEX_PAGE,
  SCRIPT_PATH,
  STYLE_PATH,
  categoryPath,
  createContext,
  rulePath,
  type RenderOptions,
  type RenderedFile,
  type SiteContext,
} from './context.js'
import { renderCategoryPage, renderIndexPage, renderRulePage } from './pages.js'
import type { RuleSet } from '../types.js'

/**
 * 검증된 규칙 모음을 정적 HTML 사이트로 렌더한다.
 * 파일을 쓰지 않고 경로·내용 쌍만 돌려주므로 CLI 밖에서도 쓸 수 있다.
 */
export function renderSite(
  set: RuleSet,
  options: RenderOptions = {},
): RenderedFile[] {
  const ctx = createContext(set, options)
  const files: RenderedFile[] = [
    { path: INDEX_PAGE, content: renderIndexPage(ctx) },
  ]

  for (const category of Object.keys(ctx.index.byCategory).sort()) {
    files.push({
      path: categoryPath(category),
      content: renderCategoryPage(ctx, category),
    })
  }
  for (const rule of ctx.rules.values()) {
    files.push({ path: rulePath(rule.meta), content: renderRulePage(ctx, rule) })
  }
  if (options.inlineAssets !== true) {
    files.push({ path: STYLE_PATH, content: STYLESHEET })
    files.push({ path: SCRIPT_PATH, content: SCRIPT })
  }
  return files
}

/** 규칙 하나만 단일 HTML 문서로 렌더한다(자산 인라인). */
export function renderRuleDocument(
  set: RuleSet,
  id: string,
  options: RenderOptions = {},
): string {
  const ctx: SiteContext = createContext(set, { ...options, inlineAssets: true })
  const rule = ctx.rules.get(id)
  if (!rule) throw new Error(`규칙을 찾을 수 없습니다: ${id}`)
  return renderRulePage(ctx, rule)
}

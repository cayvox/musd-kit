/**
 * MK-027. `code-theme.mjs` is a plain ES module with no types, shared by the landing site and
 * the VitePress docs config. Bringing `docs/.vitepress/config.ts` under typecheck surfaced it
 * twice: first as an implicit `any` import, then, once `allowJs` let TypeScript read the
 * object, as a shape mismatch against shiki's `ThemeRegistrationResolved`, which requires
 * `settings`, `fg` and `bg`.
 *
 * The mismatch has NO runtime consequence: this is a valid raw TextMate theme, shiki accepts
 * it, and `pnpm build:site` renders both the landing site and the docs with it. What was wrong
 * was the declaration, not the theme, so the declaration is what is fixed. `ThemeRegistrationRaw`
 * is the arm of shiki's union this object actually belongs to.
 */
import type { ThemeRegistrationRaw } from 'shiki'

export declare const codeTheme: ThemeRegistrationRaw
export default codeTheme

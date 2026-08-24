import { describe, expect, it } from 'vitest'

/**
 * MK-028, pinned chain free so it runs on EVERY Node in the matrix.
 *
 * The react fork tests run in a DOM environment and reach the fork through viem, whose
 * HTTP transport builds `new Request(url, { signal })` from an `AbortController` it
 * creates itself (`viem/utils/rpc/http.ts:118`). Plain jsdom replaces `AbortController`
 * and `AbortSignal` but supplies neither `fetch` nor `Request`, so the test file gets
 * jsdom's signal paired with Node's `Request`. From Node 24 on, undici brand checks that
 * signal and throws, and every RPC call in the file fails before an assertion runs.
 *
 * This lives in the UNIT project on purpose. The fork gate runs one Node, pinned from
 * `.nvmrc`, and no local run used it; the `Checks` matrix runs three. Putting the pin here
 * is what makes a Node that breaks the pairing fail fast, on every version we claim to
 * support, instead of only in the one job nobody was reading (MK-029).
 *
 * The DOM environment is applied by `environmentMatchGlobs` in `vitest.workspace.mts`, not
 * by a `@vitest-environment` docblock: vitest 2 parses that docblock with
 * `/@(?:vitest|jest)-environment\s+([\w-]+)\b/`, which cannot express a path, so a custom
 * environment named by path is silently ignored there and the file runs on plain node.
 */
describe('MK-028, the DOM environment keeps a fetch stack that Node accepts', () => {
  it('the environment supplies a DOM', () => {
    expect(typeof globalThis.window).toBe('object')
    expect(typeof document.createElement('div')).toBe('object')
  })

  it('AbortSignal comes from the same realm as Request, so undici accepts it', () => {
    const controller = new AbortController()
    // The exact call viem makes. Under plain jsdom on Node 24 this throws
    // `TypeError: RequestInit: Expected signal ("AbortSignal {}") to be an instance of
    // AbortSignal` and the whole suite collapses into HttpRequestError.
    expect(
      () =>
        new Request('http://127.0.0.1:1/', {
          method: 'POST',
          body: '{}',
          signal: controller.signal,
        }),
    ).not.toThrow()
  })

  it('the static AbortSignal factories are from that same realm too', () => {
    expect(
      () => new Request('http://127.0.0.1:1/', { signal: AbortSignal.timeout(50) }),
    ).not.toThrow()
  })
})

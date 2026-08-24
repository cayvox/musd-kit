import { type Environment, builtinEnvironments } from 'vitest/environments'

/**
 * MK-028. jsdom, but with Node's `AbortController` and `AbortSignal` left in place.
 *
 * The react tests need a DOM for React Testing Library, and they talk to the anvil fork
 * through viem, whose HTTP transport builds `new Request(url, { signal })` where `signal`
 * comes from a `new AbortController()` it creates itself.
 *
 * jsdom supplies its own `AbortController`/`AbortSignal` and does NOT supply `fetch` or
 * `Request`. Vitest's jsdom environment copies the jsdom window over `globalThis`, so a
 * test file ends up with jsdom's `AbortSignal` paired with Node's `Request`. That pair is
 * the defect: from Node 24 on, undici brand checks `RequestInit.signal` against its own
 * `AbortSignal` class and throws
 *
 *   TypeError: RequestInit: Expected signal ("AbortSignal {}") to be an instance of
 *   AbortSignal
 *
 * turning every RPC call in the file into `HttpRequestError: HTTP request failed`. Node 20
 * and 22 accept the foreign signal, which is why five local runs on Node 20 were green
 * while the CI fork gate, pinned to `.nvmrc` (24.19.0), failed four times out of four.
 *
 * Measured, in this environment, on Node 24: `String(globalThis.AbortSignal)` under the
 * plain `node` environment starts `class AbortSignal extends EventTarget`, and under
 * `jsdom` it starts `class AbortSignal extends globalObject.E`. Only the second is
 * rejected by `new Request`.
 *
 * The fix is to keep the fetch stack self consistent: jsdom for the DOM, Node for the two
 * globals that belong to the fetch implementation actually in use. Nothing else changes,
 * and a real consumer never sees the mismatch, because a browser pairs its own
 * `AbortSignal` with its own `fetch` and a Node process pairs Node's with Node's.
 *
 * `packages/react/test/abort-signal.test.ts` pins this on every Node in the matrix.
 */

// Captured at module load. Vitest executes this module BEFORE it populates the jsdom
// globals, so these are Node's, which is the whole point. Reading them inside `setup`
// would read jsdom's and restore nothing.
const nodeAbortController = globalThis.AbortController
const nodeAbortSignal = globalThis.AbortSignal

const jsdomNodeAbort: Environment = {
  name: 'jsdom-node-abort',
  transformMode: 'web',
  async setup(global, options) {
    const { teardown } = await builtinEnvironments.jsdom.setup(global, options)
    global.AbortController = nodeAbortController
    global.AbortSignal = nodeAbortSignal
    return { teardown }
  },
}

export default jsdomNodeAbort

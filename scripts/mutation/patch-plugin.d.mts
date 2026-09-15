/** The type of `patch-plugin.mjs`, for `vitest.workspace.mts` (MK-112). */
export declare function mutationPatch(): {
  name: string
  enforce?: 'pre'
  load?: (id: string) => string | null
}

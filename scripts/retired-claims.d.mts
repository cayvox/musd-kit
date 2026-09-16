/** Types for `retired-claims.mjs`, so the unit pins that import it typecheck (MK-246). */
export interface RetiredClaim {
  finding: string
  claim: RegExp
  correct: string
}
export interface ShippedText {
  path: string
  text: string
}
export interface RetiredClaimHit {
  finding: string
  path: string
  line: number
  text: string
  correct: string
}
export declare const RETIRED_CLAIMS: RetiredClaim[]
export declare function shippedTexts(dir: string): ShippedText[]
export declare function findRetiredClaims(
  texts: ShippedText[],
  claims?: RetiredClaim[],
): RetiredClaimHit[]

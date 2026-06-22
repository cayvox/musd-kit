import { describe, expect, it } from 'vitest'
import { DEPLOYMENTS, UnsupportedChain, getAddresses } from '../src'

/**
 * Ground truth from `docs/01-ground-truth.md` §4, transcribed by hand HERE (and only
 * here) so the cross-check has an independent reference: the SDK's `DEPLOYMENTS` come
 * from `@mezo-org/musd-contracts`; this map comes from the verified doc. They must
 * agree exactly, or one of them is stale, STOP and reconcile. No fork needed:
 * this is a pure equality gate.
 */
const GROUND_TRUTH = {
  31611: {
    borrowerOperations: '0xCdF7028ceAB81fA0C6971208e83fa7872994beE5',
    troveManager: '0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0',
    sortedTroves: '0x722E4D24FD6Ff8b0AC679450F3D91294607268fA',
    hintHelpers: '0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6',
    priceFeed: '0x86bCF0841622a5dAC14A313a15f96A95421b9366',
    interestRateManager: '0xD4D6c36A592A2c5e86035A6bca1d57747a567f37',
    musd: '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503',
  },
  31612: {
    borrowerOperations: '0x44b1bac67dDA612a41a58AAf779143B181dEe031',
    troveManager: '0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193',
    sortedTroves: '0x8C5DB4C62BF29c1C4564390d10c20a47E0b2749f',
    hintHelpers: '0xD267b3bE2514375A075fd03C3D9CBa6b95317DC3',
    priceFeed: '0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88',
    interestRateManager: '0x4a453700d157717Fe02fB62E7700ED7845048285',
    musd: '0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186',
  },
} as const

describe('addresses, cross-check vs ground-truth §4 (zero-assumption gate)', () => {
  it('every @mezo-org/musd-contracts address equals ground-truth §4 (both networks)', () => {
    for (const chainId of [31611, 31612] as const) {
      const pkg = DEPLOYMENTS[chainId]
      const gt = GROUND_TRUTH[chainId]
      for (const key of Object.keys(gt) as (keyof typeof gt)[]) {
        expect(pkg[key].toLowerCase(), `${chainId}/${key}`).toBe(gt[key].toLowerCase())
      }
    }
  })

  it('getAddresses resolves supported chains and applies overrides', () => {
    expect(getAddresses(31611)).toEqual(DEPLOYMENTS[31611])
    expect(getAddresses(31612)).toEqual(DEPLOYMENTS[31612])

    const custom = '0x000000000000000000000000000000000000dEaD' as const
    expect(getAddresses(31611, { priceFeed: custom }).priceFeed).toBe(custom)
  })

  it('throws UnsupportedChain for an unknown chain without a full override', () => {
    expect(() => getAddresses(1)).toThrow(UnsupportedChain)
  })
})

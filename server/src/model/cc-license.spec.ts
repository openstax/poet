import { expect } from '@jest/globals'

import { getCCLicense, licenseEqual } from './cc-license'

describe('getCCLicense', () => {
  it('returns a License object with expected properties for localized versions', () => {
    const license = getCCLicense(
      'https://creativecommons.org/licenses/by-nc-sa/4.0/deed.en',
      'Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License'
    )

    expect(license).toEqual({
      url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/deed.en',
      type: 'Creative Commons Attribution-NonCommercial-ShareAlike',
      version: '4.0',
      text: 'Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License'
    })
  })

  it('returns a License object with expected properties for non-localized versions', () => {
    const license = getCCLicense(
      'https://creativecommons.org/licenses/by-nc-sa/4.0',
      ''
    )

    expect(license).toEqual({
      url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
      type: 'Creative Commons Attribution-NonCommercial-ShareAlike',
      version: '4.0',
      text: 'Creative Commons Attribution-NonCommercial-ShareAlike License'
    })
  })

  it('throws an error if the license text is missing when required', () => {
    expect(() => getCCLicense(
      'https://creativecommons.org/licenses/by-nc-sa/4.0/deed.en',
      ''
    )).toThrow('Expected license text')
  })

  it('throws an error if the license URL is empty', () => {
    expect(() => getCCLicense(
      '',
      'Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License'
    )).toThrow('Unrecognized licenseUrl: ""')
  })

  it('throws an error if the license URL is malformed', () => {
    expect(() => getCCLicense(
      'https://creativecommons.org/licenses/by/4.0/aaa/',
      'Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License'
    )).toThrow('Unrecognized licenseUrl: "https://creativecommons.org/licenses/by/4.0/aaa/"')
  })

  it('throws an error if the license type contains an unrecognized attribute', () => {
    expect(() => getCCLicense(
      'https://creativecommons.org/licenses/by-nderp/4.0/deed.en',
      'Creative Commons Attribution-NoDerivatives 4.0 International License'
    )).toThrow('Unrecognized CC license attribute')
  })
})

describe('licenseEqual', () => {
  it('returns true when licenses are equal', () => {
    const license = getCCLicense(
      'https://creativecommons.org/licenses/by-nc-sa/4.0/deed.en',
      'Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License'
    )

    expect(licenseEqual(license, ({
      url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/deed.en',
      type: 'Creative Commons Attribution-NonCommercial-ShareAlike',
      version: '4.0',
      text: 'Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License'
    }))).toBe(true)
  })

  it('returns false when licenses are not equal', () => {
    const license = getCCLicense(
      'https://creativecommons.org/licenses/by-nc-sa/4.0/deed.en',
      'Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License'
    )

    expect(licenseEqual(license, ({
      url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/deed.en',
      type: 'Creative Commons Attribution-NonCommercial-ShareAlike',
      version: '1337.0',
      text: 'Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License'
    }))).toBe(false)
  })
})

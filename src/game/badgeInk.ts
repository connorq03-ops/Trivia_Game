export function relativeLuminance(hex: string): number {
  const channel = (index: number) => {
    const value = parseInt(hex.replace('#', '').slice(index, index + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}

// Higher-contrast pick between white and near-black ink for a badge fill.
export function badgeInk(primary: string): string {
  const luminance = relativeLuminance(primary)
  const whiteRatio = (1 + 0.05) / (luminance + 0.05)
  const blackRatio = (luminance + 0.05) / (relativeLuminance('#131313') + 0.05)
  return whiteRatio >= blackRatio ? '#ffffff' : '#131313'
}

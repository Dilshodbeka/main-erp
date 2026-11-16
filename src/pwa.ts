export interface BeforeInstallPrompt { prompt: () => Promise<void>; }

export interface InstallBannerInput { standalone: boolean; dismissed: boolean; available: boolean; }

export function shouldShowInstallBanner(input: InstallBannerInput): boolean {
  return input.available && !input.standalone && !input.dismissed;
}

export function isStandalone(match = (q: string) => window.matchMedia?.(q).matches): boolean {
  return match('(display-mode: standalone)');
}

export function isIos(userAgent: string): boolean {
  return /iphone|ipad|ipod/i.test(userAgent);
}

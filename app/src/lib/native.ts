import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';

/** Android integration: back button closes panels first, then navigates back, then leaves the app. */
export function setupNative() {
  if (!Capacitor.isNativePlatform()) return;
  StatusBar.setStyle({ style: Style.Light }).catch(() => {});
  App.addListener('backButton', ({ canGoBack }) => {
    if (document.querySelector('.overlay')) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    } else if (canGoBack && !['#/painel', '#/agenda', ''].includes(location.hash)) {
      history.back();
    } else {
      App.exitApp();
    }
  });
}

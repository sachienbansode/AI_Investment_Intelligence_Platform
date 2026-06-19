// Native (Capacitor) initialisation. No-op on plain web — every call is guarded
// so the web build runs even if the Capacitor packages aren't installed.
export async function initNative() {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor || !Capacitor.isNativePlatform || !Capacitor.isNativePlatform()) return

    try {
      const { StatusBar, Style } = await import('@capacitor/status-bar')
      const dark = document.documentElement.getAttribute('data-theme') !== 'light'
      await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light })
    } catch { /* plugin absent */ }

    try {
      const { SplashScreen } = await import('@capacitor/splash-screen')
      await SplashScreen.hide()
    } catch { /* plugin absent */ }

    try {
      // Android hardware back button: let the browser history handle it.
      const { App } = await import('@capacitor/app')
      App.addListener('backButton', ({ canGoBack }) => {
        if (canGoBack) window.history.back()
        else App.exitApp()
      })
    } catch { /* plugin absent */ }
  } catch {
    /* @capacitor/core not present — running as a normal website */
  }
}

// Register this device for push notifications; returns the token or null.
// Safe no-op on web. The backend stores it via api.registerDevice().
export async function registerPush(onToken) {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor || !Capacitor.isNativePlatform()) return null
    const { PushNotifications } = await import('@capacitor/push-notifications')
    const perm = await PushNotifications.requestPermissions()
    if (perm.receive !== 'granted') return null
    await PushNotifications.register()
    PushNotifications.addListener('registration', t => onToken && onToken(t.value))
  } catch { /* plugin absent */ }
  return null
}

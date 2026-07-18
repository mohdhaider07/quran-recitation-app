import './global.css';
import React, { useRef, useState } from 'react';
import {
  StatusBar,
  ActivityIndicator,
  View,
  Platform,
  BackHandler,
  Image,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

const APP_URL = 'https://quran-ambience.vercel.app/';

// JavaScript injected into the WebView to make it feel more app-like:
// - Disables long-press context menus
// - Disables text selection
// - Disables pinch-to-zoom
// - Hides scrollbars
// - Prevents pull-to-refresh overscroll
// - Listens for theme changes and posts them back to React Native
const INJECTED_JS = `
  (function() {
    // Disable context menu (long-press)
    document.addEventListener('contextmenu', function(e) {
      e.preventDefault();
    });

    // Disable text selection & scrollbars, prevent overscroll
    var style = document.createElement('style');
    style.textContent = \`
      * {
        -webkit-user-select: none !important;
        user-select: none !important;
        -webkit-touch-callout: none !important;
      }
      input, textarea {
        -webkit-user-select: text !important;
        user-select: text !important;
      }
      ::-webkit-scrollbar {
        display: none !important;
      }
      body {
        overscroll-behavior: none !important;
        -webkit-overflow-scrolling: touch;
      }
    \`;
    document.head.appendChild(style);

    // Set viewport for proper mobile rendering
    var viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) {
      viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
    }

    // Notify React Native about the current active theme
    function sendThemeUpdate() {
      if (window.ReactNativeWebView) {
        var body = document.body;
        var themeKey = body.getAttribute('data-theme') || 'mint';
        var isDark = body.classList.contains('dark') || themeKey === 'dark';
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'THEME_CHANGE',
          theme: themeKey,
          isDark: isDark
        }));
      }
    }

    // Wait for body to be ready
    if (document.body) {
      sendThemeUpdate();
    } else {
      document.addEventListener('DOMContentLoaded', sendThemeUpdate);
    }

    // Monitor theme variations dynamically via MutationObserver
    var observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        if (mutation.attributeName === 'data-theme' || mutation.attributeName === 'class') {
          sendThemeUpdate();
        }
      });
    });

    if (document.body) {
      observer.observe(document.body, { attributes: true });
    } else {
      document.addEventListener('DOMContentLoaded', function() {
        observer.observe(document.body, { attributes: true });
      });
    }

    true;
  })();
`;

// Theme configuration mapping matching variables in globals.css
const THEME_MAP: Record<string, { bg: string; statusStyle: 'dark-content' | 'light-content'; accent: string }> = {
  mint: { bg: '#f0fdfa', statusStyle: 'dark-content', accent: '#0d9488' },
  pearl: { bg: '#f8fafc', statusStyle: 'dark-content', accent: '#059669' },
  cream: { bg: '#fffbeb', statusStyle: 'dark-content', accent: '#d97706' },
  lavender: { bg: '#faf5ff', statusStyle: 'dark-content', accent: '#9333ea' },
  sand: { bg: '#fff7ed', statusStyle: 'dark-content', accent: '#ea580c' },
  rose: { bg: '#fff1f2', statusStyle: 'dark-content', accent: '#e11d48' },
  dark: { bg: '#020617', statusStyle: 'light-content', accent: '#10b981' },
};

export default function App() {
  const webViewRef = useRef<WebView>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  // Set defaults based on 'mint' (the default theme shown in the user's screenshot)
  const [safeAreaColor, setSafeAreaColor] = useState('#f0fdfa');
  const [statusBarStyle, setStatusBarStyle] = useState<'dark-content' | 'light-content'>('dark-content');
  const [themeAccentColor, setThemeAccentColor] = useState('#0d9488');

  // Handle Android hardware back button
  React.useEffect(() => {
    if (Platform.OS === 'android') {
      const backHandler = BackHandler.addEventListener(
        'hardwareBackPress',
        () => {
          if (webViewRef.current) {
            webViewRef.current.goBack();
            return true;
          }
          return false;
        }
      );
      return () => backHandler.remove();
    }
  }, []);

  // Handle message from the WebView
  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'THEME_CHANGE') {
        const themeKey = data.theme || 'mint';
        const isDark = data.isDark;
        
        // Find matching theme configuration, fallback to dark/mint if unknown
        const themeConfig = THEME_MAP[themeKey] || (isDark ? THEME_MAP.dark : THEME_MAP.mint);
        
        setSafeAreaColor(themeConfig.bg);
        setStatusBarStyle(themeConfig.statusStyle);
        setThemeAccentColor(themeConfig.accent);
      }
    } catch (e) {
      console.warn('Failed to parse WebView theme message:', e);
    }
  };

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: safeAreaColor }}>
        <StatusBar
          barStyle={statusBarStyle}
          backgroundColor={safeAreaColor}
          translucent={false}
        />
        <SafeAreaView style={{ flex: 1, backgroundColor: safeAreaColor }}>
          <WebView
            ref={webViewRef}
            source={{ uri: APP_URL }}
            style={{ flex: 1, backgroundColor: safeAreaColor }}
            injectedJavaScript={INJECTED_JS}
            onMessage={handleMessage}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            startInLoadingState={false}
            scalesPageToFit={true}
            allowsInlineMediaPlayback={true}
            mediaPlaybackRequiresUserAction={false}
            allowsFullscreenVideo={true}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            bounces={false}
            overScrollMode="never"
            onLoadStart={() => setIsLoading(true)}
            onLoadEnd={() => setIsLoading(false)}
            onShouldStartLoadWithRequest={(request) => {
              return true;
            }}
            cacheEnabled={true}
            cacheMode="LOAD_DEFAULT"
            pullToRefreshEnabled={false}
            accessibilityLabel="Quran Ambience App"
          />

          {/* Loading overlay */}
          {isLoading && (
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: safeAreaColor, alignItems: 'center', justifyContent: 'center' }}>
              <Image 
                source={require('./assets/icon.png')} 
                style={{ width: 120, height: 120, marginBottom: 24, borderRadius: 24 }} 
                resizeMode="contain"
              />
              <ActivityIndicator size="large" color={themeAccentColor} />
            </View>
          )}
        </SafeAreaView>
      </View>
    </SafeAreaProvider>
  );
}

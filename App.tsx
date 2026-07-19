import './global.css';
import React, { useRef, useState, useCallback } from 'react';
import {
  StatusBar,
  ActivityIndicator,
  View,
  Platform,
  BackHandler,
  Image,
  Text,
  AppState,
  type AppStateStatus,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Audio } from 'expo-av';

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
const THEME_MAP: Record<
  string,
  { bg: string; statusStyle: 'dark-content' | 'light-content'; accent: string }
> = {
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
  const [webViewLoading, setWebViewLoading] = useState(true);
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);

  // Enforce a minimum of 4 seconds loading duration on initial launch
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setMinTimeElapsed(true);
    }, 2500);
    return () => clearTimeout(timer);
  }, []);

  const isLoading = webViewLoading || !minTimeElapsed;

  // Set defaults based on 'mint' (the default theme shown in the user's screenshot)
  const [safeAreaColor, setSafeAreaColor] = useState('#f0fdfa');
  const [statusBarStyle, setStatusBarStyle] = useState<'dark-content' | 'light-content'>(
    'dark-content'
  );
  const [themeAccentColor, setThemeAccentColor] = useState('#0d9488');

  // Handle Android hardware back button
  React.useEffect(() => {
    if (Platform.OS === 'android') {
      const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
        if (webViewRef.current) {
          webViewRef.current.goBack();
          return true;
        }
        return false;
      });
      return () => backHandler.remove();
    }
  }, []);

  // Native Audio player refs
  const soundRef = useRef<Audio.Sound | null>(null);
  const playlistRef = useRef<any[]>([]);
  const currentIndexRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(false);
  const currentTimeRef = useRef<number>(0);
  const durationRef = useRef<number>(0);
  const isMutedRef = useRef<boolean>(false);
  const volumeRef = useRef<number>(0.8);

  // Configure audio mode on mount
  React.useEffect(() => {
    const setupAudio = async () => {
      try {
        await Audio.setAudioModeAsync({
          staysActiveInBackground: true,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });
      } catch (e) {
        console.warn('Failed to setup Audio mode:', e);
      }
    };
    setupAudio();
    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync();
      }
    };
  }, []);

  const sendEventToWebView = useCallback((type: string, payload: any) => {
    if (webViewRef.current) {
      const jsStr = `
        if (window.onNativeAudioEvent) {
          window.onNativeAudioEvent(JSON.stringify({
            type: ${JSON.stringify(type)},
            payload: ${JSON.stringify(payload)}
          }));
        }
        true;
      `;
      webViewRef.current.injectJavaScript(jsStr);
    }
  }, []);

  const sendSyncState = useCallback(() => {
    sendEventToWebView('SYNC_STATE', {
      currentIndex: currentIndexRef.current,
      isPlaying: isPlayingRef.current,
      currentTime: currentTimeRef.current,
      duration: durationRef.current,
    });
  }, [sendEventToWebView]);

  const onPlaybackStatusUpdate = (status: any) => {
    if (!status.isLoaded) {
      if (status.error) {
        console.error(`Native playback error: ${status.error}`);
      }
      return;
    }

    currentTimeRef.current = status.positionMillis / 1000;
    durationRef.current = (status.durationMillis || 0) / 1000;
    isPlayingRef.current = status.isPlaying;

    sendEventToWebView('TIME_UPDATE', { currentTime: currentTimeRef.current });
    if (status.durationMillis) {
      sendEventToWebView('DURATION_CHANGE', { duration: durationRef.current });
    }

    if (status.didJustFinish) {
      handleTrackFinished();
    }
  };

  const handleTrackFinished = async () => {
    const nextIndex = currentIndexRef.current + 1;
    if (nextIndex < playlistRef.current.length) {
      currentIndexRef.current = nextIndex;
      sendEventToWebView('TRACK_CHANGE', { index: nextIndex });
      await playTrackAtIndex(nextIndex);
    } else {
      isPlayingRef.current = false;
      sendEventToWebView('PLAYBACK_STATUS', { isPlaying: false });
    }
  };

  const playTrackAtIndex = async (index: number) => {
    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }

      const ayah = playlistRef.current[index];
      if (!ayah || !ayah.audio) {
        console.warn(`No audio URL for index ${index}`);
        return;
      }

      const { sound } = await Audio.Sound.createAsync(
        { uri: ayah.audio },
        {
          shouldPlay: isPlayingRef.current,
          volume: isMutedRef.current ? 0 : volumeRef.current,
        },
        onPlaybackStatusUpdate
      );

      soundRef.current = sound;
    } catch (error) {
      console.error('Failed to load/play native audio track:', error);
    }
  };

  // ─── AppState: sync state after screen unlock ───────────────────────────
  const appStateRef = React.useRef<AppStateStatus>(AppState.currentState);
  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const wasBackground = appStateRef.current.match(/inactive|background/);
      const isNowActive = nextState === 'active';

      if (wasBackground && isNowActive && webViewRef.current) {
        sendSyncState();
      }

      appStateRef.current = nextState;
    });

    return () => subscription.remove();
  }, [sendSyncState]);
  // ─────────────────────────────────────────────────────────────────────────

  // Handle message from the WebView
  const handleMessage = async (event: any) => {
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
      } else if (data.type === 'WEB_READY') {
        sendSyncState();
      } else if (data.type === 'SET_PLAYLIST') {
        const { ayahs, currentIndex, isPlaying, volume, isMuted } = data.payload;

        volumeRef.current = volume ?? volumeRef.current;
        isMutedRef.current = isMuted ?? isMutedRef.current;
        isPlayingRef.current = isPlaying ?? isPlayingRef.current;

        const isSamePlaylist =
          playlistRef.current.length === ayahs.length &&
          playlistRef.current[0]?.audio === ayahs[0]?.audio;

        playlistRef.current = ayahs;

        if (!isSamePlaylist || currentIndexRef.current !== currentIndex) {
          currentIndexRef.current = currentIndex;
          await playTrackAtIndex(currentIndex);
        } else {
          // Playlist and track are same, just sync play/pause status
          if (soundRef.current) {
            if (isPlayingRef.current) {
              await soundRef.current.playAsync();
            } else {
              await soundRef.current.pauseAsync();
            }
          }
        }
      } else if (data.type === 'PLAY') {
        isPlayingRef.current = true;
        sendEventToWebView('PLAYBACK_STATUS', { isPlaying: true });
        if (soundRef.current) {
          await soundRef.current.playAsync();
        } else {
          await playTrackAtIndex(currentIndexRef.current);
        }
      } else if (data.type === 'PAUSE') {
        isPlayingRef.current = false;
        sendEventToWebView('PLAYBACK_STATUS', { isPlaying: false });
        if (soundRef.current) {
          await soundRef.current.pauseAsync();
        }
      } else if (data.type === 'SEEK') {
        const { time } = data.payload;
        if (soundRef.current) {
          await soundRef.current.setPositionAsync(time * 1000);
        }
      } else if (data.type === 'SET_VOLUME') {
        const { volume, isMuted } = data.payload;
        volumeRef.current = volume;
        isMutedRef.current = isMuted;
        if (soundRef.current) {
          await soundRef.current.setVolumeAsync(isMuted ? 0 : volume);
        }
      }
    } catch (e) {
      console.warn('Failed to parse WebView message:', e);
    }
  };

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: safeAreaColor }}>
        <StatusBar barStyle={statusBarStyle} backgroundColor={safeAreaColor} translucent={false} />
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
            onLoadStart={() => setWebViewLoading(true)}
            onLoadEnd={() => setWebViewLoading(false)}
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
            <View
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: safeAreaColor,
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 999,
              }}>
              <View
                style={{
                  shadowColor: themeAccentColor,
                  shadowOffset: { width: 0, height: 12 },
                  shadowOpacity: 0.4,
                  shadowRadius: 16,
                  elevation: 16,
                  marginBottom: 24,
                  borderRadius: 24,
                  backgroundColor: '#ffffff',
                }}>
                <Image
                  source={require('./assets/icon.png')}
                  style={{ width: 120, height: 120, borderRadius: 24 }}
                  resizeMode="contain"
                />
              </View>
              <Text
                style={{
                  fontSize: 28,
                  fontWeight: 'bold',
                  color: themeAccentColor,
                  marginBottom: 24,
                  letterSpacing: 0.5,
                }}>
                Quran Ambience
              </Text>
              <ActivityIndicator size="large" color={themeAccentColor} />
            </View>
          )}
        </SafeAreaView>
      </View>
    </SafeAreaProvider>
  );
}

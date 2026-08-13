// PianoWorks Crescendo 用 Service Worker
//
// 目的：
//  ・アプリ本体(HTML/JS)を、次回以降すぐ開けるようキャッシュする
//  ・ピアノ音源(opus)は「一度読み込んだら、二度と読み直さない」キャッシュ・ファースト戦略にする
//    (通常音質・高音質どちらも対象。高音質は容量が大きいぶん、この効果が特に大きい)
//
// バージョンを上げると、古いキャッシュは自動的に破棄され、新しい内容に更新される。
// ファイル構成を変えた時は CACHE_VERSION の数字を上げること。
const CACHE_VERSION = 'pianoworks-c-v1';
const SHELL_CACHE = CACHE_VERSION + '-shell';
const SAMPLE_CACHE = CACHE_VERSION + '-samples';

// アプリの土台(これが無いと起動できないファイル)。インストール時に先読みしておく
const SHELL_ASSETS = [
  './',
  './index.html',
  './assets/audio-engine.js',
  './assets/jukebox.js',
  './assets/midi-import.js',
  './assets/midiplayer.js',
  './assets/skin.js',
  './assets/story.js',
  './assets/studio.js'
];

self.addEventListener('install', function (event) {
  self.skipWaiting(); // 新しいバージョンをすぐ有効化する
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      // 1つでも404等で失敗すると全体が失敗してしまうため、個別にキャッチして
      // 「読めたものだけキャッシュする」ようにする(初回インストール自体が失敗しないように)
      return Promise.all(SHELL_ASSETS.map(function (url) {
        return cache.add(url).catch(function (err) {
          console.warn('[sw] shell precache failed:', url, err);
        });
      }));
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (key) { return key !== SHELL_CACHE && key !== SAMPLE_CACHE; })
          .map(function (key) { return caches.delete(key); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

// ピアノ音源(soft/mid/loud/hqフォルダ配下のopusファイル)かどうかを判定する
function isPianoSampleRequest(url) {
  return /\/(soft|mid|loud|hq)\//.test(url.pathname) && url.pathname.endsWith('.opus');
}

self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // 他サイトへのリクエストには干渉しない
  if (event.request.method !== 'GET') return;

  if (isPianoSampleRequest(url)) {
    // ピアノ音源：一度取得できたファイルは、以後ずっとキャッシュから返す(キャッシュ・ファースト)。
    // タブを閉じたり端末を再起動したりしても、次回以降は再ダウンロード不要になる
    event.respondWith(
      caches.open(SAMPLE_CACHE).then(function (cache) {
        return cache.match(event.request).then(function (cached) {
          if (cached) return cached;
          return fetch(event.request).then(function (response) {
            if (response && response.ok) cache.put(event.request, response.clone());
            return response;
          });
        });
      })
    );
    return;
  }

  // それ以外(HTML/JS/画像/動画など)：まずネットワークを試し、取れたら同時にキャッシュも更新する。
  // オフライン・回線不調時はキャッシュへフォールバックする
  event.respondWith(
    fetch(event.request).then(function (response) {
      if (response && response.ok) {
        var clone = response.clone();
        caches.open(SHELL_CACHE).then(function (cache) { cache.put(event.request, clone); });
      }
      return response;
    }).catch(function () {
      return caches.match(event.request);
    })
  );
});

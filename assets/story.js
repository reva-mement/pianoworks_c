// assets/story.js
// ストーリーモード。「第◯夜」という単位でオムニバス形式の短い話を並べる。
// デザインはJukeboxに準拠。今はダミーの読む画面のみ、第1夜だけ閲覧可能。

import { fadeBgm } from './jukebox.js';
import { getPianoCtx } from './audio-engine.js';

var STORIES = [
  {
    id: 'night1',
    title: '第1夜',
    available: true,
    pages: [
      // ―― 起 ――
      'むかしむかし、まだ蒸気機関車が黒い煙を空にくべていた頃、イングランドの片隅に小さな村がありました。\n\nその村はずれの深い森には、誰も足を踏み入れない一角があると言い伝えられていました。',

      '少女だけは、その禁じられた森へ通っていました。\n\n森の奥、蔦に覆われた廃墟の中に、一台のピアノがひっそりと置かれていたのです。かつてそこには、大きなお屋敷が建っていたのだと、少女は聞いたことがありました。',

      'ピアノを弾くと、決まって一羽の白い鳥が、崩れた窓辺にとまりました。\n\n村の老人たちは言いました。「あの屋敷の火事で、若いお嬢様は帰らぬ人となった。今もあの子は、ピアノの音を聴きに来るのだ」と。',

      // ―― 承 ――
      '少女はその話を、半分だけ信じていました。\n\nそれでも、白い鳥が窓辺に来るたび、まるで誰かに聴いてもらっているような、不思議な心地がしたのです。冬の午後、少女の指はどんどん軽やかになっていきました。',

      '「その森には、あまり深く入り込まないほうがいい」\n\n祖母は、暖炉の前で少女にそう言い聞かせました。「あそこには、まだ終わっていない歌が眠っているのだから」その言葉の意味を、少女はまだ知りませんでした。',

      'ある日、少女はピアノの鍵盤の隙間に、小さな紙切れが挟まっているのを見つけました。\n\n色あせたインクで、楽譜の切れ端が書きつけられていました。曲の途中で、まるで誰かに遮られたかのように、そこで途切れていたのです。',

      // ―― 転 ――
      '少女は、その続きを弾いてみようと思い立ちました。\n\n指を鍵盤に置いた瞬間、白い鳥が初めて、少女のすぐそばまで舞い降りてきました。まるで、ずっとこの日を待っていたかのように。',

      '途切れた旋律の先を、少女は自分の心で紡いでいきました。\n\n弾き終えた瞬間、崩れた窓から柔らかな光が差し込み、白い鳥はふわりと宙に舞い上がりました。それはまるで、誰かがようやく肩の荷を下ろしたかのようでした。',

      // ―― 結 ――
      'それきり、白い鳥は森に現れなくなりました。\n\n村の老人たちは、「お嬢様は、ようやく眠りについたのだろう」と噂しあいました。少女には、それが悲しいことだとは、なぜだか思えませんでした。',

      'それから少女は、毎日その森へ通いました。\n\n今度は、誰かに弾いてもらうためではなく、自分自身のために。廃墟のピアノは、少女だけの音を覚え始めていました。\n\n（第2夜へつづく）'
    ]
  },
  { id: 'night2', title: '第2夜', available: false, pages: [] },
  { id: 'night3', title: '第3夜', available: false, pages: [] }
];

// ページめくり中の状態
var currentStory = null;
var currentPageIndex = 0;
var isFlipping = false;

// ================================================================
// Storyモード中のテーマ曲（Crescendo）：強制再生＋フェードイン
// ================================================================
var THEME_FADE_MS = 500;
var themeFadeRaf = null;

function getStoryThemeEl() {
  return document.getElementById('story-theme-bgm');
}

// jukebox.jsのfadeBgmと同じ考え方のシンプルなフェード（対象がstory-theme-bgmである点だけが違う）
function fadeStoryTheme(targetVolume, durationMs) {
  var theme = getStoryThemeEl();
  if (!theme) return;
  if (themeFadeRaf) cancelAnimationFrame(themeFadeRaf);

  if (targetVolume > 0 && theme.paused) {
    theme.play().catch(function () {});
  }

  var startVolume = theme.volume;
  var startTime = performance.now();

  function step(now) {
    var t = Math.min(1, (now - startTime) / durationMs);
    var rawVolume = startVolume + (targetVolume - startVolume) * t;
    theme.volume = Math.max(0, Math.min(1, rawVolume));
    if (t < 1) {
      themeFadeRaf = requestAnimationFrame(step);
    } else {
      themeFadeRaf = null;
      if (targetVolume === 0) theme.pause();
    }
  }
  themeFadeRaf = requestAnimationFrame(step);
}

function renderStoryList() {
  var list = document.getElementById('story-list');
  if (!list) return;
  list.innerHTML = '';
  STORIES.forEach(function (story) {
    var row = document.createElement('div');
    row.style.cssText = "display:flex; align-items:center; padding:14px 2px; border-bottom:1px solid rgba(232,150,66,0.4);" + (story.available ? " cursor:pointer;" : " opacity:0.45;");

    var title = document.createElement('div');
    title.style.cssText = "font-family:'Yomogi', cursive; font-size:14px; color:#f3ede0; letter-spacing:0.5px; flex:1;";
    title.textContent = story.title;

    var status = document.createElement('div');
    status.style.cssText = "flex-shrink:0; font-family:'Yomogi', cursive; font-size:12px; color:#e8a24a; margin-right:10px;";
    status.textContent = story.available ? '' : '近日公開';

    row.appendChild(title);
    row.appendChild(status);

    if (story.available) {
      var playBtn = document.createElement('div');
      playBtn.style.cssText = "flex-shrink:0; width:28px; height:28px; border-radius:50%; border:1px solid rgba(232,150,66,0.7); display:flex; align-items:center; justify-content:center; color:#efe4cf; font-size:12px; cursor:pointer;";
      playBtn.textContent = '▶';
      playBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openStoryRead(story);
      });
      row.appendChild(playBtn);
      row.addEventListener('click', function () {
        openStoryRead(story);
      });
    }
    list.appendChild(row);
  });
}

function showOverlay(id) {
  var el = document.getElementById(id);
  el.style.display = 'flex';
  requestAnimationFrame(function () {
    requestAnimationFrame(function () { el.style.opacity = '1'; });
  });
}
function hideOverlay(id) {
  var el = document.getElementById(id);
  el.style.opacity = '0';
  setTimeout(function () { el.style.display = 'none'; }, 900);
}

export function openStoryList() {
  showOverlay('story-list-overlay');
  renderStoryList();
}

export function closeStoryList() {
  hideOverlay('story-list-overlay');
}

export function openStoryRead(story) {
  // 現時点では動画・曲は出し分けせずダミー固定だが、本文だけはstory.pagesを見て
  // ページめくり形式で表示する。将来的にはstory.idごとに動画・曲も出し分ける。
  currentStory = story;
  currentPageIndex = 0;
  isFlipping = false;

  // 破れエフェクト用レイヤーを初期状態にリセット（前回の読了時の状態が残らないように）
  var frontEl = document.getElementById('story-tear-front');
  var whiteEl = document.getElementById('story-tear-white');
  var backEl = document.getElementById('story-tear-back');
  [frontEl, whiteEl, backEl].forEach(function (el) {
    if (!el) return;
    el.style.animation = 'none';
    el.style.clipPath = 'none';
  });
  if (whiteEl) whiteEl.style.visibility = 'hidden';
  if (backEl) {
    backEl.style.visibility = 'hidden';
    backEl.style.transition = 'none';
    backEl.style.backgroundColor = '#efe9dc';
    var backTextElReset = backEl.querySelector('.story-page-text');
    if (backTextElReset) {
      backTextElReset.style.transition = 'none';
      backTextElReset.style.opacity = '0';
    }
  }

  renderCurrentPage();

  // ★テーマ曲（Crescendo）を強制再生。既存のBGMは既存の演出と同じ流儀でダッキングし、
  //   テーマ曲を0.5sかけてフェードインさせる
  fadeBgm(0, THEME_FADE_MS);
  var theme = getStoryThemeEl();
  if (theme) {
    theme.currentTime = 0;
    theme.volume = 0;
  }
  fadeStoryTheme(0.7, THEME_FADE_MS);

  hideOverlay('story-list-overlay');
  showOverlay('story-read-overlay');
}

function getPages() {
  return (currentStory && currentStory.pages && currentStory.pages.length) ? currentStory.pages : [''];
}

function renderCurrentPage() {
  var pages = getPages();
  var textEl = document.querySelector('#story-tear-front .story-page-text');
  if (textEl) textEl.textContent = pages[currentPageIndex] || '';
  updatePageIndicatorAndNav();
}

// インジケーター（1 / 10 など）と、両端でのナビ無効化だけを更新する。
// front側のテキストには触れない（めくりアニメーション中に誤って先読みさせないため）。
function updatePageIndicatorAndNav() {
  var pages = getPages();
  var indicator = document.getElementById('story-page-indicator');
  if (indicator) indicator.textContent = (currentPageIndex + 1) + ' / ' + pages.length;

  var prevZone = document.getElementById('story-page-prev-zone');
  var nextZone = document.getElementById('story-page-next-zone');
  var prevBtn = document.getElementById('story-page-prev-btn');
  var nextBtn = document.getElementById('story-page-next-btn');
  var hasPrev = currentPageIndex > 0;
  var hasNext = currentPageIndex < pages.length - 1;
  if (prevZone) prevZone.style.cursor = hasPrev ? 'pointer' : 'default';
  if (nextZone) nextZone.style.cursor = hasNext ? 'pointer' : 'default';
  if (prevBtn) prevBtn.classList.toggle('story-page-nav-btn-disabled', !hasPrev);
  if (nextBtn) nextBtn.classList.toggle('story-page-nav-btn-disabled', !hasNext);
}

// ================================================================
// ページめくり：不規則な鋸歯状（ギザギザ）の破れエフェクト
// story_pageflip_v4_step15_bugfixed.jsx のロジックをそのままvanilla JSへ移植したもの。
// ================================================================
var tearAnimCounter = 0;
var TEAR_DURATION_MS = 480;

// ★デバッグ用フラグ：trueにすると、めくりアニメーションを最後まで進めず、
// ギザギザが最大に開く48%地点で一時停止したまま止める（形の確認・調整用）。
// 確認が終わったら false に戻すこと。
var DEBUG_PAUSE_TEAR_AT_PEAK = false;

// 破れ終わって次ページ（白紙）が完全に露出してから、本来の背景色・文章へ
// 進んでいくまでの各段階の時間
var WHITE_HOLD_MS = 160;   // 白紙のまま静止する時間
var TEXT_POP_MS = 220;     // 白紙の上にテキストがすっと表示されるまでの時間
var CROSSFADE_MS = 750;    // テキスト表示後、背景が白から本来の色へフェードインする時間

// ================================================================
// ページをめくる音（SE）：音声ファイルを追加せず、ホワイトノイズをフィルターで
// 「紙」らしい質感に加工して合成する。ピアノと同じAudioContextを共有する。
// ================================================================
function playPageTurnSE(direction) {
  try {
    var ctx = getPianoCtx();
    var duration = 0.22;
    var bufferSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
    var buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1; // ホワイトノイズ
    }

    var noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = buffer;

    // バンドパスで帯域を絞り、「シャッ」という紙らしい質感にする。
    // 次のページへ(direction=1)は周波数を上向きに、前のページへ(-1)は下向きに掃引し、
    // めくる方向に合わせた「しゅっ」という向きの手触りをつける
    var bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.Q.value = 0.9;
    var now = ctx.currentTime;
    var freqFrom = direction >= 0 ? 1800 : 4200;
    var freqTo = direction >= 0 ? 4200 : 1800;
    bandpass.frequency.setValueAtTime(freqFrom, now);
    bandpass.frequency.linearRampToValueAtTime(freqTo, now + duration * 0.8);

    var highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 700;

    var gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.32, now + 0.02); // 素早く立ち上がる
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration); // 滑らかに減衰

    noiseSrc.connect(bandpass).connect(highpass).connect(gainNode).connect(ctx.destination);
    noiseSrc.start(now);
    noiseSrc.stop(now + duration + 0.02);
  } catch (err) { /* SE再生に失敗しても致命的ではないので無視する */ }
}

// 高さHの範囲を、4〜9pxのランダムな帯（歯）に分割する。
// 各歯には、先端(tip)がどれだけ奥まで飛び出るかを決めるamplitude(px)を持たせる。
function generateTeeth(H, W) {
  var teeth = [];
  var y = 0;
  while (y < H) {
    var toothHeight = 4 + Math.random() * 5;
    var h = (y + toothHeight > H) ? (H - y) : toothHeight;
    // amplitude: 中間地点で、境界からどれだけ奥(まだ見えている側)へ尖って残るか。
    // 画面幅の4%〜50%でランダムに散らす
    var amplitude = (0.04 + Math.random() * 0.46) * W;
    teeth.push({ yStart: y, yEnd: y + h, amplitude: amplitude });
    y += h;
  }
  return teeth;
}

// mirror=false: 通常（右→左に破れる。次のページへ進む時）
// mirror=true : 左右反転した境界形状（左→右に破れる。前のページへ戻る時）
function mx(x, W, mirror) {
  return mirror ? (W - x) : x;
}

// notchBaseX: その瞬間の「谷」の基準位置（歯と歯の間はここに揃う）
// tipExtraRatio: 0なら谷と同じ（ギザギザなし）。1に近いほど、歯の中間地点だけ
//                amplitudeぶん「破れていく側」へ突き出る（★歯の向きを反転：以前は逆側=まだ
//                見えている側へ飛び出ていたが、破れる方向へ尖るように変更）
// ★座標は px ではなく、その要素自身のサイズに対する % で出力する。pxだと「測定した瞬間の
//   画面サイズ」に焼き付けられてしまい、モバイルでアドレスバーの出現/収納などにより
//   実際の表示領域が変わった時にズレて見えることがあったため（%なら常にその時点の
//   実サイズに対して正しい位置になる）
function buildPolygon(teeth, notchBaseX, tipExtraRatio, W, H, mirror) {
  var pts = [];
  function pt(x, y) {
    var xPct = (mx(x, W, mirror) / W) * 100;
    var yPct = (y / H) * 100;
    pts.push(xPct + '% ' + yPct + '%');
  }
  pt(0, 0);
  teeth.forEach(function (t) {
    var tipX = notchBaseX - t.amplitude * tipExtraRatio;
    var midY = (t.yStart + t.yEnd) / 2;
    pt(notchBaseX, t.yStart);
    pt(tipX, midY);
  });
  pt(notchBaseX, H);
  pt(0, H);
  return 'polygon(' + pts.join(',') + ')';
}

// 開始(0%)：ページ全体が見えている（長方形、ギザギザなし）
// 中間(48%)：半分ほど千切れつつ、ギザギザが最大に開く
// 終了(100%)：完全に千切れて消える（長方形、ギザギザなし）
function buildTearKeyframesCss(teeth, animName, W, H, mirror) {
  var clip0 = buildPolygon(teeth, W, 0, W, H, mirror);
  var clip50 = buildPolygon(teeth, W * 0.42, 1, W, H, mirror);
  var clip100 = buildPolygon(teeth, 0, 0, W, H, mirror);
  // front（現在のページ）用：ギザギザを持たない、まっすぐな境界線だけ（常にtipExtraRatio=0）
  var flat0 = buildPolygon(teeth, W, 0, W, H, mirror);
  var flat50 = buildPolygon(teeth, W * 0.42, 0, W, H, mirror);
  var flat100 = buildPolygon(teeth, 0, 0, W, H, mirror);
  return '@keyframes ' + animName + '-clip {' +
    ' 0% { clip-path: ' + clip0 + '; }' +
    ' 48% { clip-path: ' + clip50 + '; }' +
    ' 100% { clip-path: ' + clip100 + '; }' +
    ' }' +
    '@keyframes ' + animName + '-flat {' +
    ' 0% { clip-path: ' + flat0 + '; }' +
    ' 48% { clip-path: ' + flat50 + '; }' +
    ' 100% { clip-path: ' + flat100 + '; }' +
    ' }';
}

function getTearKeyframesStyleEl() {
  var el = document.getElementById('story-tear-keyframes');
  if (!el) {
    el = document.createElement('style');
    el.id = 'story-tear-keyframes';
    document.head.appendChild(el);
  }
  return el;
}

// direction: 1 = 次のページへ（右から破れて次ページが見える）, -1 = 前のページへ（左から破れる）
function flipToPage(direction) {
  if (isFlipping) return; // アニメーション中の連打を無視
  var pages = getPages();
  var targetIndex = currentPageIndex + direction;
  if (targetIndex < 0 || targetIndex >= pages.length) return;

  var viewport = document.getElementById('story-page-viewport');
  var frontEl = document.getElementById('story-tear-front');
  var whiteEl = document.getElementById('story-tear-white');
  var backEl = document.getElementById('story-tear-back');
  var frontTextEl = frontEl ? frontEl.querySelector('.story-page-text') : null;
  var backTextEl = backEl ? backEl.querySelector('.story-page-text') : null;

  if (!viewport || !frontEl || !whiteEl || !backEl || !frontTextEl || !backTextEl) {
    // 万一DOMが無ければアニメーションなしで即切り替え
    currentPageIndex = targetIndex;
    renderCurrentPage();
    return;
  }

  // ★clientWidth/clientHeightだと、端末のDPRやレイアウトの端数によっては歯の形の
  //   計算がわずかにずれることがあるため、getBoundingClientRectを整数に丸めて使う
  var rect = viewport.getBoundingClientRect();
  var W = Math.round(rect.width);
  var H = Math.round(rect.height);
  if (W <= 0 || H <= 0) {
    currentPageIndex = targetIndex;
    renderCurrentPage();
    return;
  }

  isFlipping = true;
  playPageTurnSE(direction);

  // 破れていく先（back）には、次に見せるページの文章を先に入れておく。
  // ★frontEl（今見えている面）のテキストはまだ書き換えない――アニメーションが
  //   終わるまでは古いページのままにしておくことで、ボタンを押した瞬間に
  //   次ページが一瞬見えてしまう不具合を防ぐ。インジケーターだけは即時更新してよい。
  backTextEl.textContent = pages[targetIndex];
  currentPageIndex = targetIndex;
  updatePageIndicatorAndNav();

  var teeth = generateTeeth(H, W);
  var animName = 'story-tear-' + (tearAnimCounter++);
  var mirror = direction < 0;
  getTearKeyframesStyleEl().textContent = buildTearKeyframesCss(teeth, animName, W, H, mirror);

  backEl.style.visibility = 'visible';
  whiteEl.style.visibility = 'visible';
  whiteEl.style.animationPlayState = 'running';
  frontEl.style.animationPlayState = 'running';
  // ★歯の向きを反転：白レイヤーを常にnotchBaseぴったりの直線境界(-flat)にし、
  //   代わりに黒の前面レイヤー側に、歯の中間地点だけ内側(まだ見えている側)へ
  //   引っ込むギザギザ(-clip、buildPolygonのtipXが notchBase - amplitude*ratio になった)
  //   を持たせる。これにより、白が黒の前面に食い込むように見える向きになる。
  whiteEl.style.animation = animName + '-flat ' + TEAR_DURATION_MS + 'ms linear forwards';
  frontEl.style.animation = animName + '-clip ' + TEAR_DURATION_MS + 'ms linear forwards';

  if (DEBUG_PAUSE_TEAR_AT_PEAK) {
    // ★デバッグ用：キーフレームの48%（ギザギザが最大に開く地点）付近で一時停止する。
    // isFlippingはtrueのままにしておき、以降のタップでは進行しない
    // （＝止まった状態をそのまま確認できる。DEBUG_PAUSE_TEAR_AT_PEAKをfalseに戻せば通常動作に戻る）
    setTimeout(function () {
      frontEl.style.animationPlayState = 'paused';
      whiteEl.style.animationPlayState = 'paused';
    }, TEAR_DURATION_MS * 0.48);
    return;
  }

  // 流れ：▶を押す → 歯のエフェクト(TEAR_DURATION_MS) → 白い画面 → 少し静止(WHITE_HOLD_MS)
  //      → 次ページのテキストが表示(TEXT_POP_MS) → 背景がフェードイン(CROSSFADE_MS) → frontへスワップ
  setTimeout(function () {
    // 破れきった瞬間：backは白紙のまま完全に露出している状態（文章はまだopacity:0）。
    setTimeout(function () {
      // 先にテキストだけを、白い紙の上にすっと表示する
      backTextEl.style.transition = 'opacity ' + TEXT_POP_MS + 'ms ease';
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          backTextEl.style.opacity = '1';
        });
      });

      setTimeout(function () {
        // テキストが表示された状態のまま、背景だけを白から本来の暗い色へフェードイン
        backEl.style.transition = 'background-color ' + CROSSFADE_MS + 'ms ease';
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            backEl.style.backgroundColor = '#131009';
          });
        });

        setTimeout(function () {
          // クロスフェードも終わったので、frontを新しいページの内容に差し替えて全面表示に戻し、
          // white/backは非表示に戻す（次回のめくりに備えてリセット）
          frontEl.style.animation = 'none';
          frontEl.style.clipPath = 'none';
          frontTextEl.textContent = pages[currentPageIndex];

          whiteEl.style.animation = 'none';
          whiteEl.style.visibility = 'hidden';
          whiteEl.style.clipPath = 'none';

          backEl.style.visibility = 'hidden';
          backEl.style.clipPath = 'none';
          backEl.style.transition = 'none';
          backEl.style.backgroundColor = '#efe9dc'; // 次回のめくりに備えて白紙へ戻す
          backTextEl.style.transition = 'none';
          backTextEl.style.opacity = '0';

          isFlipping = false;
        }, CROSSFADE_MS + 30);
      }, TEXT_POP_MS + 30);
    }, WHITE_HOLD_MS);
  }, TEAR_DURATION_MS + 30);
}

export function closeStoryRead() {
  // テーマ曲をフェードアウトし、通常のBGMを元の音量へ戻す
  fadeStoryTheme(0, THEME_FADE_MS);
  fadeBgm(0.7, THEME_FADE_MS);

  // ★一覧画面を経由せず、読了画面からメイン画面へ直接フェードアウトで戻る
  //   （story-list-overlayはread-overlayの下で表示されたままになっているので、
  //   両方を同時にhideOverlayすることで、どちらもフェードしながらメイン画面が現れる）
  hideOverlay('story-read-overlay');
  hideOverlay('story-list-overlay');
}

export function initStory() {
  var listCloseBtn = document.getElementById('story-list-close');
  if (listCloseBtn) {
    listCloseBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      closeStoryList();
    });
  }
  var readCloseBtn = document.getElementById('story-read-close');
  if (readCloseBtn) {
    readCloseBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      closeStoryRead();
    });
  }

  var prevZone = document.getElementById('story-page-prev-zone');
  if (prevZone) {
    prevZone.addEventListener('click', function (e) {
      e.stopPropagation();
      flipToPage(-1);
    });
  }
  var nextZone = document.getElementById('story-page-next-zone');
  if (nextZone) {
    nextZone.addEventListener('click', function (e) {
      e.stopPropagation();
      flipToPage(1);
    });
  }

  var prevBtn = document.getElementById('story-page-prev-btn');
  if (prevBtn) {
    prevBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      flipToPage(-1);
    });
  }
  var nextBtn = document.getElementById('story-page-next-btn');
  if (nextBtn) {
    nextBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      flipToPage(1);
    });
  }
}

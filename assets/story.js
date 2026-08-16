// assets/story.js
// ストーリーモード。「第◯夜」という単位でオムニバス形式の短い話を並べる。
// デザインはJukeboxに準拠。今はダミーの読む画面のみ、第1夜だけ閲覧可能。

var STORIES = [
  {
    id: 'night1',
    title: '第1夜',
    available: true,
    pages: [
      // ―― 起 ――
      '森は、もう何も歌わない。\n\n灰色に色を失った木々の合間に、一台のピアノだけが、かつての音を覚えている。',

      '少女には、名前がない。\n\n名前もまた、この森がとうに食べてしまったものの一つだから。ただ鍵盤の前に座り、指を置くことだけを覚えている。',

      '強く弾いてはいけない。\n\n大きな音を鳴らすたび、森はまた一本、音もなく立ち枯れていく。だから少女は、いつも囁くような音しか出さない。',

      // ―― 承 ――
      'かつて、誰かがここで、同じ鍵盤に触れていた。\n\nその輪郭はもう思い出せない。ただ――少しずつ、少しずつ強くしていくようにと書かれた、書きかけの楽譜だけが、少女の中に残っている。',

      '少女は、その続きを弾こうとした。\n\n一音重ねるたび、森の色がまた一つ、静かに失われていく。それでも、指は止まらなかった。',

      '――これを弾き終えたら、何が残るのだろう。\n\n森のように、自分の記憶もいつか、音もなく枯れていくのかもしれない。少女の指が、震えながら止まる。',

      // ―― 転 ――
      'ふと、少女は気づいてしまう。\n\nあの「誰か」の顔も、声も、もう思い出せない。もしかしたら、最初からそんな人はいなかったのかもしれない――そんな気さえした。',

      'それでも。\n\n誰かがいた証も、いなかった証も、どちらもここにはない。ならば、この楽譜を弾き終えることだけが、少女に残された唯一の答えだった。',

      // ―― 結 ――
      '最後の一音に向かって、少女は鍵盤を強く踏み込む。\n\n森が、音もなく崩れ落ちていく。何かを失うことでしか、辿り着けない場所があった。',

      '弾き終えたピアノは、二度と鳴らない。\n\nそれでも少女は、静かに微笑んでいた。――これでよかったのだと、誰かに言われた気がしたから。\n\n（第2夜へつづく）'
    ]
  },
  { id: 'night2', title: '第2夜', available: false, pages: [] },
  { id: 'night3', title: '第3夜', available: false, pages: [] }
];

// ページめくり中の状態
var currentStory = null;
var currentPageIndex = 0;
var isFlipping = false;

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
function buildPolygon(teeth, notchBaseX, tipExtraRatio, W, H, mirror) {
  var pts = [];
  function pt(x, y) { pts.push(mx(x, W, mirror) + 'px ' + y + 'px'); }
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

  var W = viewport.clientWidth;
  var H = viewport.clientHeight;
  if (W <= 0 || H <= 0) {
    currentPageIndex = targetIndex;
    renderCurrentPage();
    return;
  }

  isFlipping = true;

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
  hideOverlay('story-read-overlay');
  showOverlay('story-list-overlay');
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

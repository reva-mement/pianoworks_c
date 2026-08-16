// assets/story.js
// ストーリーモード。「第◯夜」という単位でオムニバス形式の短い話を並べる。
// デザインはJukeboxに準拠。今はダミーの読む画面のみ、第1夜だけ閲覧可能。

var STORIES = [
  {
    id: 'night1',
    title: '第1夜',
    available: true,
    // 現時点ではダミー固定。将来的にはstory.idごとに、プロットから書き起こした
    // 本文をここに差し込む（1要素＝1ページ）。
    pages: [
      'これはダミーのテキストです。ここに、1話ぶんの物語が、ページをめくるように流れていきます。',
      '実際にはプロットをもとに書き起こした文章が入り、画面上部の動画と、ループする曲に合わせて読み進めていく形になります。\n\n画面の左側をタップすると前のページへ、右側をタップすると次のページへ、紙をめくるように進みます。',
      'しおり機能を使えば、途中で閉じても、また同じ場所から読み始めることができます。\n\n（これは3ページ目のダミーです）'
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
  if (backEl) backEl.style.visibility = 'hidden';

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
  var indicator = document.getElementById('story-page-indicator');
  if (textEl) textEl.textContent = pages[currentPageIndex] || '';
  if (indicator) indicator.textContent = (currentPageIndex + 1) + ' / ' + pages.length;

  // 現在地に合わせて、両端でのタップを無効化（前ページが無い/次ページが無い場合は反応させない）
  var prevZone = document.getElementById('story-page-prev-zone');
  var nextZone = document.getElementById('story-page-next-zone');
  if (prevZone) prevZone.style.cursor = currentPageIndex > 0 ? 'pointer' : 'default';
  if (nextZone) nextZone.style.cursor = currentPageIndex < pages.length - 1 ? 'pointer' : 'default';
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
var DEBUG_PAUSE_TEAR_AT_PEAK = true;

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
//                amplitudeぶん奥へ飛び出る
function buildPolygon(teeth, notchBaseX, tipExtraRatio, W, H, mirror) {
  var pts = [];
  function pt(x, y) { pts.push(mx(x, W, mirror) + 'px ' + y + 'px'); }
  pt(0, 0);
  teeth.forEach(function (t) {
    var tipX = notchBaseX + t.amplitude * tipExtraRatio;
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

  // 破れていく先（back）には、次に見せるページの文章を先に入れておく
  backTextEl.textContent = pages[targetIndex];
  currentPageIndex = targetIndex;
  renderCurrentPage(); // frontの表示はこの時点ではまだ古いページのまま（アニメーションで置き換える）

  var teeth = generateTeeth(H, W);
  var animName = 'story-tear-' + (tearAnimCounter++);
  var mirror = direction < 0;
  getTearKeyframesStyleEl().textContent = buildTearKeyframesCss(teeth, animName, W, H, mirror);

  backEl.style.visibility = 'visible';
  whiteEl.style.visibility = 'visible';
  whiteEl.style.animationPlayState = 'running';
  frontEl.style.animationPlayState = 'running';
  whiteEl.style.animation = animName + '-clip ' + TEAR_DURATION_MS + 'ms linear forwards';
  frontEl.style.animation = animName + '-flat ' + TEAR_DURATION_MS + 'ms linear forwards';

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

  setTimeout(function () {
    // 破れ終わったので、frontを新しいページの内容に差し替えて全面表示に戻し、
    // white/backは非表示に戻す（次回のめくりに備えてリセット）
    frontEl.style.animation = 'none';
    frontEl.style.clipPath = 'none';
    frontTextEl.textContent = pages[currentPageIndex];

    whiteEl.style.animation = 'none';
    whiteEl.style.visibility = 'hidden';
    whiteEl.style.clipPath = 'none';

    backEl.style.visibility = 'hidden';
    backEl.style.clipPath = 'none';

    isFlipping = false;
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
}

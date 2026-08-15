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
  renderCurrentPage();

  hideOverlay('story-list-overlay');
  showOverlay('story-read-overlay');
}

function getPages() {
  return (currentStory && currentStory.pages && currentStory.pages.length) ? currentStory.pages : [''];
}

function renderCurrentPage() {
  var pages = getPages();
  var textEl = document.querySelector('#story-page-current .story-page-text');
  var indicator = document.getElementById('story-page-indicator');
  if (textEl) textEl.textContent = pages[currentPageIndex] || '';
  if (indicator) indicator.textContent = (currentPageIndex + 1) + ' / ' + pages.length;

  // 現在地に合わせて、両端でのタップを無効化（前ページが無い/次ページが無い場合は反応させない）
  var prevZone = document.getElementById('story-page-prev-zone');
  var nextZone = document.getElementById('story-page-next-zone');
  if (prevZone) prevZone.style.cursor = currentPageIndex > 0 ? 'pointer' : 'default';
  if (nextZone) nextZone.style.cursor = currentPageIndex < pages.length - 1 ? 'pointer' : 'default';
}

// direction: 1 = 次のページへ（右→左にめくる）, -1 = 前のページへ（左→右にめくる）
function flipToPage(direction) {
  if (isFlipping) return; // アニメーション中の連打を無視
  var pages = getPages();
  var targetIndex = currentPageIndex + direction;
  if (targetIndex < 0 || targetIndex >= pages.length) return;

  var flipEl = document.getElementById('story-page-flip');
  var frontTextEl = flipEl ? flipEl.querySelector('.story-page-flip-front .story-page-text') : null;
  if (!flipEl || !frontTextEl) {
    // 万一DOMが無ければアニメーションなしで即切り替え
    currentPageIndex = targetIndex;
    renderCurrentPage();
    return;
  }

  isFlipping = true;

  // めくられる側（表面）には、今まさに画面に見えているページの文章を複製する。
  // 下地(#story-page-current)は先に次のページへ更新しておき、
  // めくり終わってこの層が消えた瞬間に自然につながるようにする。
  frontTextEl.textContent = pages[currentPageIndex];
  currentPageIndex = targetIndex;
  renderCurrentPage();

  flipEl.classList.remove('flipping');
  flipEl.classList.toggle('flip-prev', direction < 0);
  flipEl.style.transform = 'rotateY(0deg)';
  flipEl.style.visibility = 'visible';

  // 一度リフローを挟んでから transform を変えないと、開始角度がtransitionに乗ってしまう
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      flipEl.classList.add('flipping');
      flipEl.style.transform = direction > 0 ? 'rotateY(-180deg)' : 'rotateY(180deg)';
    });
  });

  var onEnd = function (e) {
    if (e && e.target !== flipEl) return;
    flipEl.removeEventListener('transitionend', onEnd);
    flipEl.classList.remove('flipping');
    flipEl.style.visibility = 'hidden';
    flipEl.style.transform = 'rotateY(0deg)';
    isFlipping = false;
  };
  flipEl.addEventListener('transitionend', onEnd);
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

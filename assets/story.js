// assets/story.js
// ストーリーモード。「第◯夜」という単位でオムニバス形式の短い話を並べる。
// デザインはJukeboxに準拠。今はダミーの読む画面のみ、第1夜だけ閲覧可能。

var STORIES = [
  { id: 'night1', title: '第1夜', available: true },
  { id: 'night2', title: '第2夜', available: false },
  { id: 'night3', title: '第3夜', available: false }
];

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

export function openStoryList() {
  // ホーム画面は非表示にせず、後ろに残したまま重ねる(すりガラス効果が実際にホーム画面を透かして見えるように)
  document.getElementById('scene-story-list').classList.remove('hidden');
  renderStoryList();
}

export function closeStoryList() {
  document.getElementById('scene-story-list').classList.add('hidden');
}

export function openStoryRead(story) {
  // 現時点では中身はダミー固定。将来的にはstory.idごとに動画・曲・テキストを出し分ける
  var listScene = document.getElementById('scene-story-list');
  var readScene = document.getElementById('scene-story-read');

  readScene.classList.remove('hidden'); // 先にreadを見せておき、その上で一覧ページがめくれて消える
  readScene.style.zIndex = '1';
  listScene.style.zIndex = '2';
  listScene.classList.add('page-turn-left');

  listScene.addEventListener('animationend', function onEnd() {
    listScene.removeEventListener('animationend', onEnd);
    listScene.classList.add('hidden');
    listScene.classList.remove('page-turn-left');
    listScene.style.zIndex = '';
    readScene.style.zIndex = '';
  });
}

export function closeStoryRead() {
  document.getElementById('scene-story-read').classList.add('hidden');
  document.getElementById('scene-story-list').classList.remove('hidden');
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
}

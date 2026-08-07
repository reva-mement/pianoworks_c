// assets/skin.js
// ノーツのスキン選択一覧。デザイン(見た目)はJukeboxに準拠している。

var SKINS = [
  { id: 'water', name: '水（バブル）', description: '角丸の輪郭に、内側で揺れる小さな泡。青い泡が1つだけ紛れている。', available: true },
  { id: 'fire', name: '炎', available: false },
  { id: 'underwater', name: '水中', available: false },
  { id: 'space', name: '宇宙', available: false },
  { id: 'sand', name: '砂', available: false }
];
var currentSkinId = 'water';
var marqueeStyleInjected = false;

function ensureMarqueeStyle() {
  if (marqueeStyleInjected) return;
  marqueeStyleInjected = true;
  var style = document.createElement('style');
  style.textContent =
    '@keyframes skinDescMarquee{0%{transform:translateX(0);}100%{transform:translateX(var(--marquee-distance));}}';
  document.head.appendChild(style);
}

function renderSkinList() {
  ensureMarqueeStyle();
  var list = document.getElementById('skin-list');
  if (!list) return;
  list.innerHTML = '';
  SKINS.forEach(function (skin) {
    var selected = skin.id === currentSkinId;
    var row = document.createElement('div');
    row.style.cssText = "display:flex; align-items:center; gap:10px; padding:12px 2px; border-bottom:1px solid " + (selected ? "rgba(232,150,66,0.85)" : "rgba(232,150,66,0.4)") + (skin.available ? "; cursor:pointer;" : "; opacity:0.45;");

    var title = document.createElement('div');
    title.style.cssText = "font-family:'Yomogi', cursive; font-size:14px; color:#f3ede0; letter-spacing:0.5px; flex-shrink:0; max-width:40%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
    title.textContent = skin.name;

    var descWrap = document.createElement('div');
    descWrap.style.cssText = "flex:1; min-width:0; overflow:hidden; white-space:nowrap; position:relative;";
    var descInner = document.createElement('span');
    descInner.style.cssText = "font-family:'Yomogi', cursive; font-size:12px; color:#a99f8c; display:inline-block;";
    descInner.textContent = skin.description || '';
    descWrap.appendChild(descInner);

    var status = document.createElement('div');
    status.style.cssText = "flex-shrink:0; font-family:'Yomogi', cursive; font-size:12px; color:#e8a24a;";
    status.textContent = skin.available ? (selected ? '選択中' : '') : '近日公開';

    row.appendChild(title);
    row.appendChild(descWrap);
    row.appendChild(status);

    if (skin.available) {
      row.addEventListener('click', function () {
        currentSkinId = skin.id;
        renderSkinList();
      });
    }
    list.appendChild(row);

    // 説明文がはみ出す場合だけ、左右にゆっくり流れるようにする
    requestAnimationFrame(function () {
      var overflow = descInner.scrollWidth - descWrap.clientWidth;
      if (overflow > 4) {
        descWrap.style.setProperty('--marquee-distance', '-' + (overflow + 6) + 'px');
        var duration = Math.max(3, overflow / 22);
        descInner.style.animation = 'skinDescMarquee ' + duration.toFixed(1) + 's ease-in-out infinite alternate';
      }
    });
  });
}

export function openSkinList() {
  document.getElementById('skin-overlay').style.display = 'flex';
  renderSkinList();
}

export function closeSkinList() {
  document.getElementById('skin-overlay').style.display = 'none';
}

export function getCurrentSkinId() {
  return currentSkinId;
}

export function initSkinList() {
  var closeBtn = document.getElementById('skin-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      closeSkinList();
    });
  }
}

// assets/studio.js
// Studio（GAME ON）画面。現時点では水（バブル）スキンのみ実装。
// 見た目確認用のダミーノーツを表示する段階で、実際のMIDI連動はまだ行っていない。

import { getCurrentSkinId } from './skin.js';
import { studioDB, fadeBgm } from './jukebox.js';

var LANES = 6;
var laneStates = [];
var built = false;
var loopStarted = false;

function buildPlayfield() {
  var playfield = document.getElementById('studio-playfield');
  if (!playfield) return;
  playfield.innerHTML = '';
  laneStates = [];
  for (var li = 0; li < LANES; li++) { laneStates.push({ notes: [], bubbles: [] }); }

  for (var i = 0; i < LANES; i++) {
    var lane = document.createElement('div');
    lane.className = 'studio-lane';

    var fallArea = document.createElement('div');
    fallArea.className = 'studio-fall-area';
    fallArea.id = 'studio-fall-' + i;

    var key = document.createElement('div');
    key.className = 'studio-key';
    key.dataset.lane = i;

    lane.appendChild(fallArea);
    lane.appendChild(key);
    playfield.appendChild(lane);
  }

  // 装飾用の黒鍵（あたり判定なし）
  var blackKeysLayer = document.createElement('div');
  blackKeysLayer.className = 'studio-black-keys-layer';
  [0, 1, 3, 4].forEach(function (boundaryIndex) {
    var bk = document.createElement('div');
    bk.className = 'studio-black-key';
    bk.style.left = ((boundaryIndex + 1) / LANES * 100) + '%';
    blackKeysLayer.appendChild(bk);
  });
  document.getElementById('scene-studio-play').appendChild(blackKeysLayer);

  // ---- ベロシティ推定 ----
  var DEFAULT_VELOCITY = 90;
  function estimateVelocity(e) {
    var touch = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    if (touch && typeof touch.radiusX === 'number' && touch.radiusX > 0) {
      var norm = Math.min(1, Math.max(0, (touch.radiusX - 8) / (20 - 8)));
      return Math.round(30 + norm * 97);
    }
    return DEFAULT_VELOCITY;
  }
  function applyVelocityVisual(keyEl, velocity) {
    var norm = velocity / 127;
    var tilt = -6 - norm * 6;
    var dip = 2 + norm * 2;
    keyEl.style.setProperty('--press-tilt', tilt + 'deg');
    keyEl.style.setProperty('--press-dip', dip + 'px');
  }

  var allKeys = Array.prototype.slice.call(document.querySelectorAll('.studio-key'));
  var activeKey = null;
  var isSliding = false;

  function keyAtPoint(x, y) {
    var el = document.elementFromPoint(x, y);
    if (!el) return null;
    return el.closest ? el.closest('.studio-key') : null;
  }
  function pressKey(key, velocity) {
    if (activeKey === key) return;
    if (activeKey) activeKey.classList.remove('pressed');
    activeKey = key;
    if (activeKey) {
      applyVelocityVisual(activeKey, velocity != null ? velocity : DEFAULT_VELOCITY);
      activeKey.classList.add('pressed');
    }
  }
  function releaseAll() {
    if (activeKey) activeKey.classList.remove('pressed');
    activeKey = null;
    isSliding = false;
  }

  allKeys.forEach(function (key) {
    key.addEventListener('pointerdown', function (e) {
      e.stopPropagation();
      isSliding = true;
      var velocity = estimateVelocity(e);
      pressKey(key, velocity);
      if (key.setPointerCapture) {
        try { key.setPointerCapture(e.pointerId); } catch (err) {}
      }
    });
  });
  document.addEventListener('pointermove', function (e) {
    if (!isSliding) return;
    var k = keyAtPoint(e.clientX, e.clientY);
    if (k) pressKey(k);
  });
  document.addEventListener('pointerup', releaseAll);
  document.addEventListener('pointercancel', releaseAll);

  // ---- 鍵盤から立ち上り続ける泡 ----
  function spawnRisingBubble(fallArea, laneIndex) {
    var b = document.createElement('div');
    b.className = 'studio-rising-bubble';
    var size = 4 + Math.random() * 6;
    b.style.width = size + 'px';
    b.style.height = size + 'px';
    b.style.left = (10 + Math.random() * 80) + '%';
    fallArea.appendChild(b);
    laneStates[laneIndex].bubbles.push({ el: b, risen: 0, speed: 90 + Math.random() * 50, size: size });
  }

  allKeys.forEach(function (key) {
    var laneIndex = parseInt(key.dataset.lane, 10);
    var fallArea = document.getElementById('studio-fall-' + laneIndex);
    var pressedLoopId = null;
    function startPressedStream() {
      if (pressedLoopId) return;
      (function loopPressed() {
        if (!key.classList.contains('pressed')) { pressedLoopId = null; return; }
        spawnRisingBubble(fallArea, laneIndex);
        pressedLoopId = setTimeout(loopPressed, 90 + Math.random() * 80);
      })();
    }
    var mo = new MutationObserver(function () {
      if (key.classList.contains('pressed')) startPressedStream();
    });
    mo.observe(key, { attributes: true, attributeFilter: ['class'] });
  });

  // 右端：鍵盤1つぶんのスコア欄(初期値は0)
  var scorePanel = document.createElement('div');
  scorePanel.className = 'studio-score-panel';
  scorePanel.innerHTML =
    '<div class="studio-score-label">SCORE</div>' +
    '<div class="studio-score-value" id="studioScoreValue">0</div>' +
    '<div class="studio-combo-label">COMBO</div>' +
    '<div class="studio-combo-value" id="studioComboValue">0</div>' +
    '<div style="flex:1;"></div>' +
    '<div class="studio-score-key-spacer"></div>';
  playfield.appendChild(scorePanel);

  // 見た目確認用：ダミーのノーツ（気泡スキン）をいくつか降らせておく
  var dummyNotes = [
    { lane: 0, top: '10%' }, { lane: 1, top: '35%' }, { lane: 2, top: '55%' },
    { lane: 3, top: '20%' }, { lane: 4, top: '70%' }, { lane: 5, top: '45%' },
    { lane: 2, top: '15%' }, { lane: 4, top: '25%' },
    { lane: 1, top: '60%', long: true }, { lane: 5, top: '10%', long: true }
  ];

  function driftMiniBubble(mini, noteHeight) {
    function moveOnce() {
      var dx = (Math.random() - 0.5) * 14;
      var dy = (Math.random() - 0.5) * Math.min(14, noteHeight * 0.3);
      mini.style.transform = 'translate(' + dx.toFixed(1) + 'px, ' + dy.toFixed(1) + 'px)';
      var nextDelay = 900 + Math.random() * 1800;
      setTimeout(moveOnce, nextDelay);
    }
    setTimeout(moveOnce, Math.random() * 1000);
  }

  function popNote(note, area) {
    if (note.classList.contains('popping')) return;
    var rect = note.getBoundingClientRect();
    var areaRect = area.getBoundingClientRect();
    var cx = rect.left - areaRect.left + rect.width / 2;
    var cy = rect.top - areaRect.top + rect.height / 2;

    note.classList.add('popping');

    var ring = document.createElement('div');
    ring.className = 'studio-splash-ring';
    var ringSize = Math.max(rect.width, rect.height) * 1.1;
    ring.style.width = ringSize + 'px';
    ring.style.height = ringSize + 'px';
    ring.style.left = cx + 'px';
    ring.style.top = cy + 'px';
    ring.style.animation = 'studioSplashRing 0.5s ease-out forwards';
    area.appendChild(ring);
    ring.addEventListener('animationend', function () { ring.remove(); });

    var dropletCount = 6 + Math.floor(Math.random() * 4);
    for (var i = 0; i < dropletCount; i++) {
      var d = document.createElement('div');
      d.className = 'studio-droplet';
      var dsize = 3 + Math.random() * 5;
      d.style.width = dsize + 'px';
      d.style.height = dsize + 'px';
      d.style.left = (cx - dsize / 2) + 'px';
      d.style.top = (cy - dsize / 2) + 'px';

      var angle = (Math.random() * Math.PI) + Math.PI;
      var dist = 18 + Math.random() * 30;
      var dx = Math.cos(angle) * dist;
      var dy = Math.sin(angle) * dist * 0.8;
      d.style.setProperty('--dx', dx.toFixed(1) + 'px');
      d.style.setProperty('--dy', dy.toFixed(1) + 'px');
      var dur = 0.4 + Math.random() * 0.25;
      d.style.animation = 'studioDropletBurst ' + dur.toFixed(2) + 's ease-out forwards';

      area.appendChild(d);
      (function (el) { el.addEventListener('animationend', function () { el.remove(); }); })(d);
    }

    note.addEventListener('animationend', function () { note.remove(); }, { once: true });
  }

  dummyNotes.forEach(function (n) {
    var area = document.getElementById('studio-fall-' + n.lane);
    var note = document.createElement('div');
    note.className = 'studio-note';

    var pitchNorm = n.lane / (LANES - 1);
    var height = (28 + Math.random() * 34) * (1.15 - pitchNorm * 0.35);
    if (n.long) { height *= 4.5; }
    var inset = 6 + Math.random() * 6;
    var areaHeight = area.clientHeight || 260;
    var startY = (parseFloat(n.top) / 100) * areaHeight;
    note.style.left = inset + 'px';
    note.style.right = inset + 'px';
    note.style.height = height + 'px';
    note.style.top = startY + 'px';

    var breatheDur = (3 + Math.random() * 1.4) * (1.25 - pitchNorm * 0.45);
    var breatheDelay = -Math.random() * breatheDur;
    note.style.animation = 'studioNoteBreathe ' + breatheDur.toFixed(2) + 's ease-in-out ' + breatheDelay.toFixed(2) + 's infinite';

    var miniCount = 4;
    for (var m = 0; m < miniCount; m++) {
      var mini = document.createElement('div');
      mini.className = (m === 0) ? 'studio-mini-bubble' : 'studio-mini-bubble-line';
      var miniSize = Math.min(height, 26) * (0.35 + Math.random() * 0.35);
      mini.style.width = miniSize + 'px';
      mini.style.height = miniSize + 'px';
      mini.style.left = (6 + Math.random() * 55) + '%';
      mini.style.top = (Math.max(4, height * 0.15)) + (Math.random() * Math.max(4, height * 0.5)) + 'px';
      note.appendChild(mini);
      driftMiniBubble(mini, height);
    }

    area.appendChild(note);

    laneStates[n.lane].notes.push({ el: note, y: startY, height: height, speed: 30 + Math.random() * 15, popped: false });

    note.addEventListener('pointerdown', function (ev) {
      ev.stopPropagation();
      var record = laneStates[n.lane].notes.filter(function (r) { return r.el === note; })[0];
      if (record && !record.popped) {
        record.popped = true;
        popNote(note, area);
      }
    });
  });

  // ---- メインループ：ノーツの落下、泡の上昇、衝突判定 ----
  var lastFrameTime = null;
  function gameLoop(ts) {
    if (document.getElementById('scene-studio-play').classList.contains('hidden')) {
      lastFrameTime = null;
      requestAnimationFrame(gameLoop);
      return;
    }
    if (lastFrameTime == null) lastFrameTime = ts;
    var dt = (ts - lastFrameTime) / 1000;
    lastFrameTime = ts;

    laneStates.forEach(function (state, laneIndex) {
      var fallArea = document.getElementById('studio-fall-' + laneIndex);
      if (!fallArea) return;
      var areaHeight = fallArea.clientHeight || 260;

      state.notes.forEach(function (record) {
        if (record.popped) return;
        record.y += record.speed * dt;
        if (record.y + record.height > areaHeight) {
          record.y = areaHeight - record.height;
        }
        record.el.style.top = record.y + 'px';
      });

      state.bubbles.forEach(function (b) {
        b.risen += b.speed * dt;
        b.el.style.bottom = b.risen + 'px';
      });

      state.bubbles.forEach(function (b) {
        if (b.consumed) return;
        var bubbleTopY = areaHeight - b.risen - b.size;
        state.notes.forEach(function (record) {
          if (record.popped) return;
          if (bubbleTopY <= record.y + record.height && bubbleTopY + b.size >= record.y) {
            record.popped = true;
            b.consumed = true;
            popNote(record.el, fallArea);
          }
        });
      });

      state.bubbles = state.bubbles.filter(function (b) {
        if (b.consumed || b.risen > areaHeight + 20) {
          if (b.el.parentNode) b.el.remove();
          return false;
        }
        return true;
      });

      state.notes = state.notes.filter(function (record) { return !record.popped; });
    });

    requestAnimationFrame(gameLoop);
  }
  if (!loopStarted) {
    loopStarted = true;
    requestAnimationFrame(gameLoop);
  }
}

// ---- Studio 曲一覧（デザインはJukeboxに準拠） ----
function drawSparkline(canvas, history) {
  var ctx = canvas.getContext('2d');
  var dpr = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  var w = rect.width, h = rect.height;
  ctx.clearRect(0, 0, w, h);

  if (!history || history.length === 0) {
    ctx.strokeStyle = 'rgba(169,164,150,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(4, h / 2);
    ctx.lineTo(w - 4, h / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }

  var maxScore = 100;
  ctx.strokeStyle = 'rgba(232,150,66,0.85)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  history.forEach(function (score, i) {
    var x = 4 + (i / Math.max(1, history.length - 1)) * (w - 8);
    var y = h - 4 - (score / maxScore) * (h - 8);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function renderStudioSongList() {
  var list = document.getElementById('studio-song-list');
  if (!list) return;
  list.innerHTML = '';
  list.textContent = '読み込み中…';

  studioDB.getAllSongs().then(function (songs) {
    list.innerHTML = '';
    if (!songs || songs.length === 0) {
      var empty = document.createElement('div');
      empty.style.cssText = "font-family:'Yomogi', cursive; font-size:13px; color:#a99f8c; padding:16px 4px;";
      empty.textContent = 'まだ曲がありません。ホーム画面のIMPORTから取り込んでください。';
      list.appendChild(empty);
      return;
    }

    songs.forEach(function (entry, i) {
      var row = document.createElement('div');
      row.style.cssText = "display:flex; align-items:center; gap:10px; padding:12px 2px; border-bottom:1px solid rgba(232,150,66,0.4);";

      var title = document.createElement('div');
      title.style.cssText = "font-family:'Yomogi', cursive; font-size:14px; color:#f3ede0; letter-spacing:0.5px; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
      title.textContent = entry.name;

      var playBtn = document.createElement('div');
      playBtn.style.cssText = "flex-shrink:0; width:28px; height:28px; border-radius:50%; border:1px solid rgba(232,150,66,0.7); display:flex; align-items:center; justify-content:center; color:#efe4cf; font-size:12px; cursor:pointer;";
      playBtn.textContent = '▶';
      playBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openStudioPlay(entry); // 再生は行わず、設定したスキンのゲーム画面へ飛ぶ
      });

      var graphCanvas = document.createElement('canvas');
      graphCanvas.style.cssText = "flex-shrink:0; width:56px; height:24px;";

      var delBtn = document.createElement('div');
      delBtn.style.cssText = "flex-shrink:0; width:24px; height:24px; display:flex; align-items:center; justify-content:center; color:#a99f8c; font-size:16px; cursor:pointer;";
      delBtn.textContent = '×';
      delBtn.addEventListener('click', async function (e) {
        e.stopPropagation();
        var confirmed = await window.showCustomConfirm('「' + entry.name + '」を削除します。本当によろしいですか？');
        if (!confirmed) return;
        studioDB.deleteSong(entry.id).then(function () {
          renderStudioSongList();
        }).catch(function (err) { console.error('delete failed:', err); });
      });

      row.appendChild(title);
      row.appendChild(playBtn);
      row.appendChild(graphCanvas);
      row.appendChild(delBtn);
      list.appendChild(row);

      drawSparkline(graphCanvas, entry.scoreHistory);
    });
  }).catch(function (err) {
    console.error('studio song list load error:', err);
    list.textContent = '曲一覧の読み込みに失敗しました。';
  });
}

// Studioボタンを押した時に開く、曲一覧画面
export function openStudioList() {
  document.getElementById('scene-home').classList.add('hidden');
  document.getElementById('scene-studio-list').classList.remove('hidden');
  fadeBgm(0, 500);
  renderStudioSongList();
}

export function closeStudioList() {
  document.getElementById('scene-studio-list').classList.add('hidden');
  document.getElementById('scene-home').classList.remove('hidden');
  fadeBgm(0.7, 500); // Jukeboxと同じ基準音量に戻す
}

// 曲一覧で再生ボタンを押した時に開く、実際のゲーム画面(現時点では水スキンのみ)
export function openStudioPlay(songEntry) {
  // 現時点では水スキンのみ実装。将来的にはgetCurrentSkinId()の値でここを分岐する。
  var skinId = getCurrentSkinId();
  if (!built) {
    buildPlayfield();
    built = true;
  }
  document.getElementById('scene-studio-list').classList.add('hidden');
  document.getElementById('scene-studio-play').classList.remove('hidden');
}

export function closeStudioPlay() {
  document.getElementById('scene-studio-play').classList.add('hidden');
  document.getElementById('scene-studio-list').classList.remove('hidden');
  renderStudioSongList(); // 一覧に戻った時、最新の状態(削除等)に合わせて再描画
}

export function initStudio() {
  var btnStudio = document.getElementById('btn-studio');
  if (btnStudio) {
    btnStudio.addEventListener('click', function (e) {
      e.stopPropagation();
      openStudioList();
    });
  }
  var listCloseBtn = document.getElementById('studio-list-close');
  if (listCloseBtn) {
    listCloseBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      closeStudioList();
    });
  }
  var playCloseBtn = document.getElementById('studio-close');
  if (playCloseBtn) {
    playCloseBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      closeStudioPlay();
    });
  }
}

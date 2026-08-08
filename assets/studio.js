// assets/studio.js
// Studio（GAME ON）画面。現時点では水（バブル）スキンのみ実装。
// 見た目確認用のダミーノーツを表示する段階で、実際のMIDI連動はまだ行っていない。

import { getCurrentSkinId } from './skin.js';
import { studioDB, fadeBgm, attachTitleExpand } from './jukebox.js';
import { playNote, getPianoCtx, loadPianoSamples, stopAllNotes } from './audio-engine.js';

var LANES = 6;
var laneStates = [];
var built = false;
var loopStarted = false;
var FALL_DURATION_MS = 2600; // ノーツが上端から鍵盤に届くまでの時間
var MISS_GRACE_MS = 600;     // 鍵盤に到達してから、取りこぼしとして静かに消えるまでの猶予

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

  // 装飾用の黒鍵は、曲の実際の音階が分かってから配置する(updateBlackKeys参照)
  var blackKeysLayer = document.createElement('div');
  blackKeysLayer.className = 'studio-black-keys-layer';
  blackKeysLayer.id = 'studio-black-keys-layer';
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

  // ---- 鍵盤から立ち上り続ける泡(水スキン限定) ----
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

  // 鍵盤付近(ヒット判定圏内)にいる、まだ弾けていないノーツを直接叩く(ノーマルスキン用)
  var HIT_ZONE_PX = 40;
  function tryHitNearestNote(fallArea, laneIndex) {
    var areaHeight = fallArea.clientHeight || 260;
    var state = laneStates[laneIndex];
    for (var i = 0; i < state.notes.length; i++) {
      var record = state.notes[i];
      if (record.popped) continue;
      if (record.y + record.height >= areaHeight - HIT_ZONE_PX) {
        record.popped = true;
        popNote(record.el, fallArea, record);
        return;
      }
    }
  }

  allKeys.forEach(function (key) {
    var laneIndex = parseInt(key.dataset.lane, 10);
    var fallArea = document.getElementById('studio-fall-' + laneIndex);
    var pressedLoopId = null;
    function startPressedStream() {
      if (pressedLoopId) return;
      (function loopPressed() {
        if (!key.classList.contains('pressed')) { pressedLoopId = null; return; }
        if (getCurrentSkinId() === 'normal') {
          tryHitNearestNote(fallArea, laneIndex); // 泡なし、直接ヒット判定
        } else {
          spawnRisingBubble(fallArea, laneIndex); // 水スキン：泡を立ち上らせる
        }
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
          if (record.missDeadline === null || record.missDeadline === undefined) {
            record.missDeadline = performance.now() + MISS_GRACE_MS;
          }
        }
        record.el.style.top = record.y + 'px';
      });

      // 取りこぼしたまま猶予時間を過ぎたノーツを、静かに片付ける
      state.notes.forEach(function (record) {
        if (record.popped) return;
        if (record.missDeadline != null && performance.now() >= record.missDeadline) {
          record.popped = true;
          record.el.style.transition = 'opacity 0.3s ease-out';
          record.el.style.opacity = '0';
          (function (el) { setTimeout(function () { if (el.parentNode) el.remove(); }, 320); })(record.el);
        }
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
            popNote(record.el, fallArea, record);
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

// 気泡内部の小さな泡を、ランダムな間隔でランダムな位置へふわっと動かし続ける
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

// ノーツが弾ける演出(水しぶき)。タップで弾いた時・泡が当たった時、どちらからも呼ばれる
function popNote(note, area, record) {
  if (note.classList.contains('popping')) return;
  if (record && record.pitch != null) {
    var v = Math.max(1, Math.min(100, record.velocity * (record.gainCompensation || 1)));
    playNote(record.pitch, v, record.duration); // 音を鳴らすのはここ1箇所だけ(二重に鳴るのを防ぐ)
    console.log('[hit] pitch=' + record.pitch);
  }
  var rect = note.getBoundingClientRect();
  var areaRect = area.getBoundingClientRect();
  var cx = rect.left - areaRect.left + rect.width / 2;
  var cy = rect.top - areaRect.top + rect.height / 2;

  note.classList.add('popping');
  var skinId = getCurrentSkinId();

  if (skinId === 'normal') {
    // ノーマルスキン：PC版と同じ、ランダムな虹色の小さな星がはじける演出
    var starCount = 6 + Math.floor(Math.random() * 4);
    for (var s = 0; s < starCount; s++) {
      var star = document.createElement('div');
      star.className = 'studio-droplet'; // 形はdropletを流用し、色だけ変える
      var ssize = 4 + Math.random() * 3;
      star.style.width = ssize + 'px';
      star.style.height = ssize + 'px';
      star.style.left = (cx - ssize / 2 + (Math.random() - 0.5) * rect.width) + 'px';
      star.style.top = (cy - ssize / 2) + 'px';
      star.style.background = 'hsl(' + Math.floor(Math.random() * 360) + ', 90%, 70%)';
      star.style.boxShadow = 'none';

      var sAngle = Math.random() * Math.PI * 2;
      var sDist = 14 + Math.random() * 22;
      star.style.setProperty('--dx', (Math.cos(sAngle) * sDist).toFixed(1) + 'px');
      star.style.setProperty('--dy', (Math.sin(sAngle) * sDist).toFixed(1) + 'px');
      var sDur = 0.35 + Math.random() * 0.25;
      star.style.animation = 'studioDropletBurst ' + sDur.toFixed(2) + 's ease-out forwards';

      area.appendChild(star);
      (function (el) { el.addEventListener('animationend', function () { el.remove(); }); })(star);
    }
  } else {
    // 水スキン：波紋+水しぶき
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
  }

  note.addEventListener('animationend', function () { note.remove(); }, { once: true });
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
      attachTitleExpand(title, entry.name);

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
  document.getElementById('studio-list-overlay').style.display = 'flex';
  fadeBgm(0, 500);
  renderStudioSongList();
}

export function closeStudioList() {
  document.getElementById('studio-list-overlay').style.display = 'none';
  fadeBgm(0.7, 500); // Jukeboxと同じ基準音量に戻す
}

// 曲一覧で再生ボタンを押した時に開く、実際のゲーム画面(現時点では水スキンのみ)
// ---- 実際の曲データを使った再生 ----

// 曲の中で最も使われている6半音の範囲を探す(この範囲の音だけをレーンに割り当てる。
// 範囲外の音は、レーンに乗せず自動で鳴らすだけにする)
// 実際のMIDIピッチをもとに、6レーンそれぞれが「黒鍵の音(♯/♭)」かどうかを判定し、
// そのレーンの上に黒鍵の飾りを重ねる。曲によって黒鍵の並びが変わる。
var SHARP_SEMITONES = { 1: true, 3: true, 6: true, 8: true, 10: true }; // C#,D#,F#,G#,A#
function updateBlackKeys(windowStart) {
  var layer = document.getElementById('studio-black-keys-layer');
  if (!layer) return;
  layer.innerHTML = '';
  for (var lane = 0; lane < LANES; lane++) {
    var semitone = ((windowStart + lane) % 12 + 12) % 12;
    if (!SHARP_SEMITONES[semitone]) continue;
    var bk = document.createElement('div');
    bk.className = 'studio-black-key';
    // そのレーンの中央に来るよう配置する(レーンの境界ではなく、実際にその音のレーンの上)
    bk.style.left = ((lane + 0.5) / LANES * 100) + '%';
    layer.appendChild(bk);
  }
}

// 同じ瞬間(ごく近い時間)に複数の音が重なっている場合、一番高い音を「主旋律の候補」とみなす。
// 和音・伴奏を含めた単純な使用頻度で範囲を選ぶと、伴奏の音数に引っ張られてしまうため、
// レーンの範囲を選ぶ時だけはこちらを使う(実際に鳴らす対象の判定には影響しない)。
function extractMelodyPitches(songData) {
  if (!songData || songData.length === 0) return [];
  var sorted = songData.slice().sort(function (a, b) { return a.time - b.time; });
  var CLUSTER_MS = 60; // このくらい近い時刻は「ほぼ同時」とみなす
  var melody = [];
  var i = 0;
  while (i < sorted.length) {
    var clusterTime = sorted[i].time;
    var j = i;
    var highest = sorted[i];
    while (j < sorted.length && sorted[j].time - clusterTime < CLUSTER_MS) {
      if (sorted[j].pitch > highest.pitch) highest = sorted[j];
      j++;
    }
    melody.push(highest);
    i = j;
  }
  return melody;
}

// 同じレーン(同じ音程)が短い間隔で連続している場合、1つの長いノーツにまとめる。
// 「連打」ではなく「押しっぱなし」で対応できるようにするため。
// この間隔(MERGE_GAP_MS)が、実際の連打・使用感に合わせて調整する部分
var MERGE_GAP_MS = 180;
function mergeRapidRepeats(chart) {
  var byLane = {};
  chart.forEach(function (n) {
    if (!byLane[n.lane]) byLane[n.lane] = [];
    byLane[n.lane].push(n);
  });

  var merged = [];
  Object.keys(byLane).forEach(function (laneKey) {
    var notes = byLane[laneKey].slice().sort(function (a, b) { return a.time - b.time; });
    var i = 0;
    while (i < notes.length) {
      var group = [notes[i]];
      var groupEnd = notes[i].time + (notes[i].duration || 0);
      var j = i + 1;
      while (j < notes.length && (notes[j].time - groupEnd) <= MERGE_GAP_MS) {
        group.push(notes[j]);
        groupEnd = notes[j].time + (notes[j].duration || 0);
        j++;
      }
      var first = group[0];
      var last = group[group.length - 1];
      merged.push({
        lane: first.lane,
        time: first.time,
        pitch: first.pitch,
        velocity: first.velocity,
        duration: (last.time + (last.duration || 0)) - first.time // 最初の音から最後の音の終わりまでを1つに
      });
      i = j;
    }
  });

  merged.sort(function (a, b) { return a.time - b.time; });
  return merged;
}

function computeLaneWindow(songData) {
  if (!songData || songData.length === 0) return 60;
  var counts = {};
  var minPitch = 200, maxPitch = 0;
  songData.forEach(function (n) {
    counts[n.pitch] = (counts[n.pitch] || 0) + 1;
    if (n.pitch < minPitch) minPitch = n.pitch;
    if (n.pitch > maxPitch) maxPitch = n.pitch;
  });
  var bestStart = minPitch;
  var bestCount = -1;
  for (var start = minPitch; start <= maxPitch - LANES + 1; start++) {
    var c = 0;
    for (var p = start; p < start + LANES; p++) c += counts[p] || 0;
    if (c > bestCount) { bestCount = c; bestStart = start; }
  }
  return bestStart;
}

// 現在再生中の曲についての状態(再生停止時にすべてクリアする)
var currentSong = {
  ctx: null,
  audioNotes: [],      // 全音符(音を鳴らす用。レーンの範囲外の音も含む)
  chart: [],            // レーンに乗る音符だけ(見た目のノーツ用)
  gainCompensation: 1,
  audioIndex: 0,
  chartIndex: 0,
  startCtxTime: 0,
  audioIntervalId: null,
  chartIntervalId: null,
  playing: false
};

function stopSongPlayback() {
  currentSong.playing = false;
  if (currentSong.audioIntervalId) { clearInterval(currentSong.audioIntervalId); currentSong.audioIntervalId = null; }
  if (currentSong.chartIntervalId) { clearInterval(currentSong.chartIntervalId); currentSong.chartIntervalId = null; }
  stopAllNotes();
  // 残っているノーツ・泡を全部片付ける
  laneStates.forEach(function (state, laneIndex) {
    state.notes.forEach(function (record) { if (record.el && record.el.parentNode) record.el.remove(); });
    state.bubbles.forEach(function (b) { if (b.el && b.el.parentNode) b.el.remove(); });
    state.notes = [];
    state.bubbles = [];
  });
}

// 見た目のノーツを1つ生成し、上端から鍵盤へ向けて落とし始める
function spawnRealNote(entry) {
  var area = document.getElementById('studio-fall-' + entry.lane);
  if (!area) return;
  var skinId = getCurrentSkinId();
  var note = document.createElement('div');

  var pitchNorm = entry.lane / (LANES - 1);
  var height = (28 + Math.random() * 10) * (1.15 - pitchNorm * 0.35);
  var durSec = Math.max(0.05, (entry.duration || 250) / 1000);
  if (durSec > 0.6) { height *= Math.min(4.5, 1 + durSec); } // 長い音符は縦長にする
  var inset = 6 + Math.random() * 6;
  note.style.left = inset + 'px';
  note.style.right = inset + 'px';
  note.style.height = height + 'px';
  note.style.top = (-height) + 'px';

  if (skinId === 'normal') {
    // ノーマルスキン：PC版と同じ、塗りつぶしの長方形。白鍵は黄金色、黒鍵は紫色
    note.className = 'studio-note skin-normal';
    var semitone = ((entry.pitch % 12) + 12) % 12;
    var isBlackKey = !!SHARP_SEMITONES[semitone];
    note.style.background = isBlackKey
      ? 'hsl(' + (260 + Math.random() * 20) + ', 70%, 60%)'
      : 'hsl(' + (40 + Math.random() * 20) + ', 80%, 65%)';
  } else {
    // 水スキン：輪郭+内部の気泡
    note.className = 'studio-note';
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
  }

  area.appendChild(note);

  var areaHeight = area.clientHeight || 260;
  var record = {
    el: note,
    y: -height,
    height: height,
    speed: areaHeight / (FALL_DURATION_MS / 1000),
    popped: false,
    missDeadline: null,
    pitch: entry.pitch,
    velocity: entry.velocity,
    duration: entry.duration,
    gainCompensation: currentSong.gainCompensation
  };
  laneStates[entry.lane].notes.push(record);

  note.addEventListener('pointerdown', function (ev) {
    ev.stopPropagation();
    if (!record.popped) {
      record.popped = true;
      popNote(note, area, record);
    }
  });
}

// 20ms間隔で「今の再生位置」をチェックし、その瞬間の音符だけを鳴らす(音声・Jukeboxと同じ考え方)
function startAudioScheduler() {
  var ctx = currentSong.ctx;
  function tick() {
    if (!currentSong.playing) return;
    var elapsedMs = (ctx.currentTime - currentSong.startCtxTime) * 1000;
    var notes = currentSong.audioNotes;
    while (currentSong.audioIndex < notes.length && notes[currentSong.audioIndex].time <= elapsedMs) {
      var n = notes[currentSong.audioIndex];
      var v = Math.max(1, Math.min(100, n.velocity * currentSong.gainCompensation));
      playNote(n.pitch, v, n.duration);
      console.log('[auto] pitch=' + n.pitch);
      currentSong.audioIndex++;
    }
    if (currentSong.audioIndex >= notes.length) {
      clearInterval(currentSong.audioIntervalId);
      currentSong.audioIntervalId = null;
    }
  }
  currentSong.audioIntervalId = setInterval(tick, 20);
  tick();
}

// 少し先(FALL_DURATION_MS分)になった見た目のノーツだけを、都度生成する
function startChartScheduler() {
  var ctx = currentSong.ctx;
  function tick() {
    if (!currentSong.playing) return;
    var elapsedMs = (ctx.currentTime - currentSong.startCtxTime) * 1000;
    var chart = currentSong.chart;
    while (currentSong.chartIndex < chart.length && (chart[currentSong.chartIndex].time - FALL_DURATION_MS) <= elapsedMs) {
      spawnRealNote(chart[currentSong.chartIndex]);
      currentSong.chartIndex++;
    }
    if (currentSong.chartIndex >= chart.length) {
      clearInterval(currentSong.chartIntervalId);
      currentSong.chartIntervalId = null;
    }
  }
  currentSong.chartIntervalId = setInterval(tick, 20);
  tick();
}

// ③②①のカウントダウンを表示してから、コールバックを呼ぶ
function runCountdown(onDone) {
  var overlay = document.getElementById('studio-countdown');
  var bubble = document.getElementById('studio-countdown-bubble');
  var numberEl = document.getElementById('studio-countdown-number');
  overlay.style.display = 'flex';

  var isNormal = getCurrentSkinId() === 'normal';
  var counts = isNormal ? ['⑤', '④', '③', '②', '①', '⓪'] : ['3', '2', '1']; // ノーマルはPC版と同じ表記
  var i = 0;
  function showNext() {
    if (document.getElementById('scene-studio-play').classList.contains('hidden')) {
      overlay.style.display = 'none'; // 途中で閉じられていたら、カウントダウンを打ち切る
      return;
    }
    if (i >= counts.length) {
      overlay.style.display = 'none';
      onDone();
      return;
    }
    numberEl.textContent = counts[i];
    bubble.classList.remove('pulse');
    void bubble.offsetWidth; // アニメーションを再始動させるためのリフロー
    bubble.classList.add('pulse');
    i++;
    setTimeout(showNext, 800);
  }
  showNext();
}

export function openStudioPlay(songEntry) {
  // 現時点では水スキンのみ実装。将来的にはgetCurrentSkinId()の値でここを分岐する。
  var skinId = getCurrentSkinId();
  if (!built) {
    buildPlayfield();
    built = true;
  }
  document.getElementById('studio-list-overlay').style.display = 'none';
  document.getElementById('scene-home').classList.add('hidden');
  document.getElementById('scene-studio-play').classList.remove('hidden');

  if (!songEntry || !songEntry.songData || songEntry.songData.length === 0) return;

  var ctx = getPianoCtx();
  if (ctx.state === 'suspended') { ctx.resume(); }

  loadPianoSamples().then(function () {
    var resumePromise = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
    resumePromise.then(function () {
      var melodyPitches = extractMelodyPitches(songEntry.songData);
      var windowStart = computeLaneWindow(melodyPitches);
      updateBlackKeys(windowStart);
      var chart = [];
      var autoNotes = [];
      songEntry.songData.forEach(function (n) {
        var lane = n.pitch - windowStart;
        if (lane >= 0 && lane < LANES) {
          // レーンに乗る音：自動では鳴らさない。ユーザーが叩いた時だけ鳴る
          chart.push({ lane: lane, time: n.time, pitch: n.pitch, velocity: n.velocity, duration: n.duration });
        } else {
          // レーンの範囲外の音：これまで通り自動で鳴らす
          autoNotes.push(n);
        }
      });

      currentSong.ctx = ctx;
      currentSong.audioNotes = autoNotes;
      chart = mergeRapidRepeats(chart);
      console.log('[debug] 主旋律候補=' + melodyPitches.length + '個(全' + songEntry.songData.length + '音符中)');
      console.log('[debug] レーンの範囲: ' + windowStart + '〜' + (windowStart + LANES - 1));
      console.log('[debug] 総音符数=' + songEntry.songData.length + ' / レーン内(叩かないと鳴らない、連打まとめ後)=' + chart.length + ' / 範囲外(自動再生)=' + autoNotes.length + ' / 自動再生の割合=' + Math.round(autoNotes.length / songEntry.songData.length * 100) + '%');
      currentSong.chart = chart;
      currentSong.gainCompensation = songEntry.gainCompensation || 1;
      currentSong.audioIndex = 0;
      currentSong.chartIndex = 0;

      runCountdown(function () {
        if (document.getElementById('scene-studio-play').classList.contains('hidden')) return; // 待っている間に閉じられていたら何もしない
        currentSong.startCtxTime = ctx.currentTime;
        currentSong.playing = true;
        startAudioScheduler();
        startChartScheduler();
      });
    });
  });
}

export function closeStudioPlay() {
  stopSongPlayback();
  document.getElementById('studio-countdown').style.display = 'none';
  document.getElementById('scene-studio-play').classList.add('hidden');
  document.getElementById('scene-home').classList.remove('hidden');
  document.getElementById('studio-list-overlay').style.display = 'flex';
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

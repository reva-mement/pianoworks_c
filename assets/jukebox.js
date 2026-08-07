// assets/jukebox.js
// 曲の取込(IMPORT)・保存(IndexedDB)・一覧表示・再生(JUKEBOX)をまとめて担当する。

import { extractNotesFromMidi } from './midi-import.js';
import { loadPianoSamples, scheduleNote, getPianoCtx } from './audio-engine.js';

// ---- IndexedDBによる永続化（本体のplaynote-db.jsと同じ考え方の簡易版） ----
var jukeboxDB = {
  db: null,
  DB_NAME: 'PianoWorksCrescendoDB',
  DB_VERSION: 1,
  STORE_NAME: 'jukeboxSongs',

  init: function () {
    var self = this;
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(self.DB_NAME, self.DB_VERSION);
      request.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(self.STORE_NAME)) {
          db.createObjectStore(self.STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
      };
      request.onsuccess = function (e) { self.db = e.target.result; resolve(self.db); };
      request.onerror = function (e) { reject(e.target.error); };
    });
  },

  saveSong: function (entry) {
    var self = this;
    return (self.db ? Promise.resolve() : self.init()).then(function () {
      return new Promise(function (resolve, reject) {
        var tx = self.db.transaction([self.STORE_NAME], 'readwrite');
        var req = tx.objectStore(self.STORE_NAME).add(entry);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  },

  getAllSongs: function () {
    var self = this;
    return (self.db ? Promise.resolve() : self.init()).then(function () {
      return new Promise(function (resolve, reject) {
        var tx = self.db.transaction([self.STORE_NAME], 'readonly');
        var req = tx.objectStore(self.STORE_NAME).getAll();
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  },

  deleteSong: function (id) {
    var self = this;
    return (self.db ? Promise.resolve() : self.init()).then(function () {
      return new Promise(function (resolve, reject) {
        var tx = self.db.transaction([self.STORE_NAME], 'readwrite');
        var req = tx.objectStore(self.STORE_NAME).delete(id);
        req.onsuccess = function () { resolve(); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }
};

var library = [];
var currentPlayback = { timeouts: [], playing: false, index: -1 };
var els = {}; // DOM要素はinitJukebox()で解決する

var BONUS_TRACK = {
  isBonus: true,
  name: 'Crescendo（特典曲）',
  audioUrl: 'assets/bonus-theme-full.mp3',
  durationMs: 0 // 実ファイルのメタデータ取得後に更新
};
var bonusAudioEl = null;

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

function renderJukeboxList() {
  var list = els.list;
  if (!list) return;
  list.innerHTML = '';

  // ---- 特典曲（削除不可、常に先頭） ----
  var bonusPlaying = currentPlayback.playing && currentPlayback.index === 'bonus';
  var bonusRow = document.createElement('div');
  bonusRow.style.cssText = "display:flex; align-items:center; gap:10px; padding:12px 2px; border-bottom:1px solid " + (bonusPlaying ? "rgba(232,150,66,0.85)" : "rgba(232,150,66,0.4)") + ";";

  var bonusMark = document.createElement('div');
  bonusMark.style.cssText = "font-family:'Yomogi', cursive; font-size:12px; color:#e8a24a; width:20px; flex-shrink:0;";
  bonusMark.textContent = '★';

  var bonusTitle = document.createElement('div');
  bonusTitle.style.cssText = "font-family:'Yomogi', cursive; font-size:14px; color:#f3ede0; letter-spacing:0.5px; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
  bonusTitle.textContent = BONUS_TRACK.name;

  var bonusPlayBtn = document.createElement('div');
  bonusPlayBtn.style.cssText = "flex-shrink:0; width:28px; height:28px; border-radius:50%; border:1px solid rgba(232,150,66,0.9); display:flex; align-items:center; justify-content:center; color:#efe4cf; font-size:12px; cursor:pointer;";
  bonusPlayBtn.textContent = bonusPlaying ? '■' : '▶';
  bonusPlayBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (bonusPlaying) { stopJukeboxPlayback(); } else { playBonusTrack(); }
  });

  // 削除ボタンの代わりに、特典曲であることを示すスペーサー（幅を通常行と揃える）
  var bonusSpacer = document.createElement('div');
  bonusSpacer.style.cssText = "flex-shrink:0; width:56px;";
  var bonusEndSpacer = document.createElement('div');
  bonusEndSpacer.style.cssText = "flex-shrink:0; width:24px;";

  bonusRow.appendChild(bonusMark);
  bonusRow.appendChild(bonusTitle);
  bonusRow.appendChild(bonusPlayBtn);
  bonusRow.appendChild(bonusSpacer);
  bonusRow.appendChild(bonusEndSpacer);
  list.appendChild(bonusRow);

  if (library.length === 0) {
    return;
  }

  library.forEach(function (entry, i) {
    var isPlaying = currentPlayback.playing && currentPlayback.index === i;

    var row = document.createElement('div');
    row.style.cssText = "display:flex; align-items:center; gap:10px; padding:12px 2px; border-bottom:1px solid " + (isPlaying ? "rgba(232,150,66,0.85)" : "rgba(169,164,150,0.3)") + ";";

    var noEl = document.createElement('div');
    noEl.style.cssText = "font-family:'Yomogi', cursive; font-size:12px; color:#a99f8c; width:20px; flex-shrink:0;";
    noEl.textContent = (i + 1);

    var title = document.createElement('div');
    title.style.cssText = "font-family:'Yomogi', cursive; font-size:14px; color:#f3ede0; letter-spacing:0.5px; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
    title.textContent = entry.name;

    var playBtn = document.createElement('div');
    playBtn.style.cssText = "flex-shrink:0; width:28px; height:28px; border-radius:50%; border:1px solid rgba(232,150,66,0.7); display:flex; align-items:center; justify-content:center; color:#efe4cf; font-size:12px; cursor:pointer;";
    playBtn.textContent = isPlaying ? '■' : '▶';
    playBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (isPlaying) { stopJukeboxPlayback(); } else { playSong(i); }
    });

    var graphCanvas = document.createElement('canvas');
    graphCanvas.style.cssText = "flex-shrink:0; width:56px; height:24px;";

    var delBtn = document.createElement('div');
    delBtn.style.cssText = "flex-shrink:0; width:24px; height:24px; display:flex; align-items:center; justify-content:center; color:#a99f8c; font-size:16px; cursor:pointer;";
    delBtn.textContent = '×';
    delBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (isPlaying) stopJukeboxPlayback();
      var target = library[i];
      library.splice(i, 1);
      renderJukeboxList();
      if (target && target.id != null) {
        jukeboxDB.deleteSong(target.id).catch(function (err) { console.error('delete failed:', err); });
      }
    });

    row.appendChild(noEl);
    row.appendChild(title);
    row.appendChild(playBtn);
    row.appendChild(graphCanvas);
    row.appendChild(delBtn);
    list.appendChild(row);

    drawSparkline(graphCanvas, entry.scoreHistory);
  });
}

function stopJukeboxPlayback() {
  currentPlayback.timeouts.forEach(function (t) { clearTimeout(t); });
  currentPlayback.timeouts = [];
  currentPlayback.playing = false;
  if (bonusAudioEl) { bonusAudioEl.pause(); bonusAudioEl.currentTime = 0; }
  renderJukeboxList();
}

function playBonusTrack() {
  stopJukeboxPlayback();
  if (!bonusAudioEl) {
    bonusAudioEl = new Audio(BONUS_TRACK.audioUrl);
    bonusAudioEl.addEventListener('ended', function () {
      currentPlayback.playing = false;
      renderJukeboxList();
    });
  }
  currentPlayback.playing = true;
  currentPlayback.index = 'bonus';
  renderJukeboxList();
  bonusAudioEl.currentTime = 0;
  bonusAudioEl.play().catch(function (err) { console.error('bonus track play failed:', err); });
}

function playSong(index) {
  stopJukeboxPlayback();
  var entry = library[index];
  if (!entry) return;

  currentPlayback.playing = true;
  currentPlayback.index = index;
  renderJukeboxList();

  loadPianoSamples().then(function () {
    if (!currentPlayback.playing || currentPlayback.index !== index) return;
    var ctx = getPianoCtx();
    // 自動再生ポリシーでAudioContextが一時停止状態のままだと、無音のまま何も鳴らない
    var resumePromise = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
    resumePromise.then(function () {
      if (!currentPlayback.playing || currentPlayback.index !== index) return;
      var startAt = ctx.currentTime + 0.15;
      entry.songData.forEach(function (note) {
        scheduleNote(note, startAt + note.time / 1000);
      });
      var endTimeout = setTimeout(function () {
        currentPlayback.playing = false;
        renderJukeboxList();
      }, entry.durationMs + 400);
      currentPlayback.timeouts.push(endTimeout);
    });
  });
}

function showImportStatus(text, autoHide) {
  var statusEl = els.importStatus;
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.style.opacity = '1';
  if (autoHide) {
    setTimeout(function () { statusEl.style.opacity = '0'; }, 2200);
  }
}

function handleMidiFile(file) {
  showImportStatus('読み込み中…', false);

  var reader = new FileReader();
  reader.onload = async function (ev) {
    var arrayBuffer = ev.target.result;
    try {
      var Lib = await import('./midiplayer.js');
      var PlayerConstructor = Lib.default.Player;
      var player = new PlayerConstructor(function () {});
      player.loadArrayBuffer(arrayBuffer);

      var parsed = extractNotesFromMidi(player);
      var entry = {
        name: file.name.replace(/\.[^/.]+$/, ''),
        songData: parsed.notes,
        durationMs: parsed.durationMs,
        scoreHistory: []
      };

      jukeboxDB.saveSong(entry).then(function (newId) {
        entry.id = newId;
        library.push(entry);
        renderJukeboxList();
      }).catch(function (err) {
        console.error('save failed:', err);
        library.push(entry);
        renderJukeboxList();
      });

      console.log('MIDI parsed:', file.name, parsed.notes.length, 'notes');

      if (parsed.notes.length > 0) {
        var durationSec = Math.round(entry.durationMs / 1000);
        showImportStatus('「' + entry.name + '」　' + parsed.notes.length + '音 / 約' + durationSec + '秒', true);
      } else {
        showImportStatus('音符が見つかりませんでした', true);
      }
    } catch (err) {
      console.error('MIDI parse error:', err);
      showImportStatus('解析に失敗しました', true);
    }
  };
  reader.onerror = function () {
    showImportStatus('読み込みに失敗しました', true);
  };
  reader.readAsArrayBuffer(file);
}

export function initJukebox() {
  els.midiInput = document.getElementById('midi-upload');
  els.importStatus = document.getElementById('import-status');
  els.btnImport = document.getElementById('btn-import');
  els.btnJukebox = document.getElementById('btn-jukebox');
  els.overlay = document.getElementById('jukebox-overlay');
  els.close = document.getElementById('jukebox-close');
  els.list = document.getElementById('jukebox-list');
  els.bgm = document.getElementById('bgm');

  els.btnImport.addEventListener('click', function () {
    els.midiInput.click();
  });

  els.midiInput.addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    handleMidiFile(file);
    els.midiInput.value = '';
  });

  els.btnJukebox.addEventListener('click', function () {
    els.overlay.style.display = 'flex';
    renderJukeboxList();
    loadPianoSamples();
    fadeBgm(0, 500);
  });

  els.close.addEventListener('click', function (e) {
    e.stopPropagation();
    stopJukeboxPlayback();
    els.overlay.style.display = 'none';
    fadeBgm(1, 500);
  });

  jukeboxDB.getAllSongs().then(function (songs) {
    library = songs;
    renderJukeboxList();
  }).catch(function (err) { console.error('jukebox DB load error:', err); });
}

// BGMの音量をなめらかにフェードさせる(targetVolume: 0〜1, durationMs: フェードにかける時間)
var bgmFadeRaf = null;
function fadeBgm(targetVolume, durationMs) {
  var bgm = els.bgm;
  if (!bgm) return;
  if (bgmFadeRaf) cancelAnimationFrame(bgmFadeRaf);

  var startVolume = bgm.volume;
  var startTime = performance.now();

  function step(now) {
    var t = Math.min(1, (now - startTime) / durationMs);
    var rawVolume = startVolume + (targetVolume - startVolume) * t;
    bgm.volume = Math.max(0, Math.min(1, rawVolume)); // 浮動小数点誤差で範囲外になるのを防ぐ
    if (t < 1) {
      bgmFadeRaf = requestAnimationFrame(step);
    } else {
      bgmFadeRaf = null;
    }
  }
  bgmFadeRaf = requestAnimationFrame(step);
}

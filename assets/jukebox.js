// assets/jukebox.js
// 曲の取込(IMPORT)・保存(IndexedDB)・一覧表示・再生(JUKEBOX)をまとめて担当する。

import { extractNotesFromMidi } from './midi-import.js';
import { loadPianoSamples, playNote, getPianoCtx, stopAllNotes } from './audio-engine.js';

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

// ---- 再生位置(シーク)を管理する状態 ----
var playbackState = {
  ctx: null,
  notes: [],
  nextIndex: 0,
  startCtxTime: 0,   // notesのtime=0が、AudioContext上のどの時刻に対応するか
  intervalId: null,
  durationMs: 0,
  gainCompensation: 1,
  seeking: false,        // シークバーをドラッグ中は true (音の予約を止める)
  frozenElapsedMs: 0      // ドラッグ中に表示・保持しておく経過時間
};
var activeSeekFillEl = null; // 再生中の行のシークバー(進捗表示)への参照

function getElapsedMs() {
  if (playbackState.seeking) return playbackState.frozenElapsedMs;
  if (!playbackState.ctx) return 0;
  return (playbackState.ctx.currentTime - playbackState.startCtxTime) * 1000;
}

// notesはtime昇順ソート済み前提。指定ミリ秒以降で最初に来る音符のインデックスを返す
function findIndexAtTime(notes, ms) {
  var lo = 0, hi = notes.length;
  while (lo < hi) {
    var mid = (lo + hi) >> 1;
    if (notes[mid].time < ms) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function updateSeekBarProgress(elapsedMs) {
  if (!activeSeekFillEl || !playbackState.durationMs) return;
  var pct = Math.max(0, Math.min(100, (elapsedMs / playbackState.durationMs) * 100));
  activeSeekFillEl.style.width = pct + '%';
}

// 指定ミリ秒の位置へ移動する(早送り・巻き戻し)
function seekTo(newElapsedMs) {
  newElapsedMs = Math.max(0, Math.min(playbackState.durationMs, newElapsedMs));
  stopAllNotes();
  playbackState.nextIndex = findIndexAtTime(playbackState.notes, newElapsedMs);
  if (playbackState.ctx) {
    playbackState.startCtxTime = playbackState.ctx.currentTime - newElapsedMs / 1000;
  }
  playbackState.frozenElapsedMs = newElapsedMs;
  updateSeekBarProgress(newElapsedMs);
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

    var seekBarTrack = document.createElement('div');
    seekBarTrack.style.cssText = "flex-shrink:0; width:70px; height:6px; border-radius:3px; background:rgba(169,164,150,0.25); position:relative;" + (isPlaying ? " cursor:pointer;" : "");
    var seekBarFill = document.createElement('div');
    seekBarFill.style.cssText = "position:absolute; top:0; left:0; height:100%; border-radius:3px; background:rgba(232,150,66,0.85); width:0%; pointer-events:none;";
    seekBarTrack.appendChild(seekBarFill);

    if (isPlaying) {
      activeSeekFillEl = seekBarFill;
      updateSeekBarProgress(getElapsedMs());

      var dragging = false;
      var posToMs = function (clientX) {
        var rect = seekBarTrack.getBoundingClientRect();
        var ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
        return ratio * playbackState.durationMs;
      };
      seekBarTrack.addEventListener('pointerdown', function (e) {
        e.stopPropagation();
        dragging = true;
        playbackState.seeking = true; // ドラッグ中は音の予約を止める(一時停止)
        stopAllNotes();
        var ms = posToMs(e.clientX);
        playbackState.frozenElapsedMs = ms;
        updateSeekBarProgress(ms);
        try { seekBarTrack.setPointerCapture(e.pointerId); } catch (err) {}
      });
      seekBarTrack.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        var ms = posToMs(e.clientX);
        playbackState.frozenElapsedMs = ms;
        updateSeekBarProgress(ms);
      });
      var endDrag = function (e) {
        if (!dragging) return;
        dragging = false;
        var ms = playbackState.frozenElapsedMs;
        seekTo(ms); // 離した位置から再生を再開する
        playbackState.seeking = false;
      };
      seekBarTrack.addEventListener('pointerup', endDrag);
      seekBarTrack.addEventListener('pointercancel', endDrag);
    }

    var delBtn = document.createElement('div');
    delBtn.style.cssText = "flex-shrink:0; width:24px; height:24px; display:flex; align-items:center; justify-content:center; color:#a99f8c; font-size:16px; cursor:pointer;";
    delBtn.textContent = '×';
    delBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var target = library[i];
      var confirmed = window.confirm('「' + (target ? target.name : 'この曲') + '」を削除します。本当によろしいですか？');
      if (!confirmed) return;

      if (isPlaying) stopJukeboxPlayback();
      library.splice(i, 1);
      renderJukeboxList();
      if (target && target.id != null) {
        jukeboxDB.deleteSong(target.id).catch(function (err) { console.error('delete failed:', err); });
      }
    });

    row.appendChild(noEl);
    row.appendChild(title);
    row.appendChild(playBtn);
    row.appendChild(seekBarTrack);
    row.appendChild(delBtn);
    list.appendChild(row);
  });
}

function stopJukeboxPlayback() {
  stopPlaybackTicking();
  currentPlayback.timeouts.forEach(function (t) { clearTimeout(t); });
  currentPlayback.timeouts = [];
  currentPlayback.playing = false;
  stopAllNotes(); // 再生中の音をすべて止める
  if (bonusAudioEl) { bonusAudioEl.pause(); bonusAudioEl.currentTime = 0; }
  activeSeekFillEl = null;
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

  // ユーザー操作(タップ)の直後、間を置かずに呼ぶ。ここで一呼吸空くと
  // ブラウザによってはユーザー操作扱いされず、音が有効化されないことがある
  var ctx = getPianoCtx();
  if (ctx.state === 'suspended') { ctx.resume(); }

  currentPlayback.playing = true;
  currentPlayback.index = index;
  renderJukeboxList();

  loadPianoSamples().then(function () {
    if (!currentPlayback.playing || currentPlayback.index !== index) return;
    var resumePromise = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
    resumePromise.then(function () {
      if (!currentPlayback.playing || currentPlayback.index !== index) return;
      playbackState.ctx = ctx;
      playbackState.notes = entry.songData;
      playbackState.nextIndex = 0;
      playbackState.startCtxTime = ctx.currentTime;
      playbackState.durationMs = entry.durationMs;
      playbackState.gainCompensation = entry.gainCompensation || 1;
      playbackState.seeking = false;
      playbackState.frozenElapsedMs = 0;
      startPlaybackTicking();
    });
  });
}

// PC版(studio.js)と同じ、リアルタイム駆動の再生方式。
// 未来のタイムスタンプでまとめて予約するのではなく、一定間隔(20ms)で「今の再生位置」を
// チェックし、その瞬間が来た音符だけを都度playNoteで鳴らす。シーク(位置移動)にも対応する。
function schedulerTick() {
  if (!currentPlayback.playing || playbackState.seeking) return;
  var elapsedMs = getElapsedMs();
  var notes = playbackState.notes;
  while (playbackState.nextIndex < notes.length && notes[playbackState.nextIndex].time <= elapsedMs) {
    var note = notes[playbackState.nextIndex];
    var adjustedVelocity = Math.max(1, Math.min(100, note.velocity * playbackState.gainCompensation));
    playNote(note.pitch, adjustedVelocity, note.duration);
    playbackState.nextIndex++;
  }
  updateSeekBarProgress(elapsedMs);
  if (elapsedMs >= playbackState.durationMs + 400) {
    currentPlayback.playing = false;
    renderJukeboxList();
  }
}

function startPlaybackTicking() {
  stopPlaybackTicking();
  playbackState.intervalId = setInterval(schedulerTick, 20);
  schedulerTick(); // 最初の分をすぐに処理しておく
}

function stopPlaybackTicking() {
  if (playbackState.intervalId) {
    clearInterval(playbackState.intervalId);
    playbackState.intervalId = null;
  }
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
      // 曲ごとのベロシティの基準がバラバラなので、平均70を基準に補正係数を計算しておく
      // (極端な曲でも破綻しないよう、補正の強さは0.5〜2.0倍の範囲に収める)
      var TARGET_AVG_VELOCITY = 70;
      var rawFactor = TARGET_AVG_VELOCITY / Math.max(1, parsed.avgVelocity);
      var gainCompensation = Math.max(0.5, Math.min(2.0, rawFactor));

      var entry = {
        name: file.name.replace(/\.[^/.]+$/, ''),
        songData: parsed.notes,
        durationMs: parsed.durationMs,
        gainCompensation: gainCompensation,
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
    fadeBgm(0.7, 500); // index.htmlで設定しているBGMの基準音量と揃える
  });

  jukeboxDB.getAllSongs().then(function (songs) {
    library = songs;
    renderJukeboxList();
  }).catch(function (err) { console.error('jukebox DB load error:', err); });

  // ---- デバッグ用：コンソールから直接いろいろ試せるようにしておく ----
  window.__jukeboxDebug = {
    getLibrary: function () { return library; },
    // 指定した曲の、最初のmaxNotes個だけを、リアルタイム駆動方式で再生する
    playLimited: function (index, maxNotes) {
      var entry = library[index];
      if (!entry) { console.log('その番号の曲はありません'); return; }
      var ctx = getPianoCtx();
      if (ctx.state === 'suspended') ctx.resume();
      var notes = entry.songData.slice(0, maxNotes);
      console.log('[debugPlayLimited]', entry.name, '先頭' + notes.length + '音のみ再生');
      playbackState.ctx = ctx;
      playbackState.notes = notes;
      playbackState.nextIndex = 0;
      playbackState.startCtxTime = ctx.currentTime;
      playbackState.durationMs = notes.length ? notes[notes.length - 1].time + 1000 : 0;
      playbackState.gainCompensation = entry.gainCompensation || 1;
      playbackState.seeking = false;
      currentPlayback.playing = true;
      startPlaybackTicking();
    },
    // 単発の音を今すぐ1つだけ鳴らす
    playOneNote: function (pitch, velocity) {
      var ctx = getPianoCtx();
      if (ctx.state === 'suspended') ctx.resume();
      playNote(pitch || 60, velocity || 80, 1000);
      console.log('[debugPlayOneNote] pitch=', pitch || 60);
    }
  };
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

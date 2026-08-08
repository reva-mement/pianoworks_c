// assets/jukebox.js
// 曲の取込(IMPORT)・保存(IndexedDB)・一覧表示・再生(JUKEBOX)をまとめて担当する。

import { extractNotesFromMidi } from './midi-import.js';
import { loadPianoSamples, playNote, getPianoCtx, stopAllNotes } from './audio-engine.js';
import { getCurrentSkinId } from './skin.js';

// ---- IndexedDBによる永続化（本体のplaynote-db.jsと同じ考え方の簡易版） ----
// JukeboxとStudioは、それぞれ別の記録として独立管理する(同じレコードを共有しない)。
// そのため、同じデータベース内に別々のストア(jukeboxSongs / studioSongs)を持たせ、
// 片方を削除してももう片方には影響しないようにしている。
var DB_NAME = 'PianoWorksCrescendoDB';
var DB_VERSION = 2;
var sharedDBPromise = null;

function openSharedDB() {
  if (sharedDBPromise) return sharedDBPromise;
  sharedDBPromise = new Promise(function (resolve, reject) {
    var request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = function (e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains('jukeboxSongs')) {
        db.createObjectStore('jukeboxSongs', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('studioSongs')) {
        db.createObjectStore('studioSongs', { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = function (e) { resolve(e.target.result); };
    request.onerror = function (e) { reject(e.target.error); };
  });
  return sharedDBPromise;
}

// storeNameを指定した、そのストア専用の読み書きオブジェクトを作る
function makeSongStore(storeName) {
  return {
    saveSong: function (entry) {
      return openSharedDB().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction([storeName], 'readwrite');
          var req = tx.objectStore(storeName).add(entry);
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { reject(req.error); };
        });
      });
    },
    getAllSongs: function () {
      return openSharedDB().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction([storeName], 'readonly');
          var req = tx.objectStore(storeName).getAll();
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { reject(req.error); };
        });
      });
    },
    deleteSong: function (id) {
      return openSharedDB().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction([storeName], 'readwrite');
          var req = tx.objectStore(storeName).delete(id);
          req.onsuccess = function () { resolve(); };
          req.onerror = function () { reject(req.error); };
        });
      });
    }
  };
}

// JukeboxとStudioは別ストア＝別管理。IMPORT時に両方へ複製して保存する(下のhandleMidiFile参照)。
export var jukeboxDB = makeSongStore('jukeboxSongs');
export var studioDB = makeSongStore('studioSongs');

var library = [];
var currentPlayback = { timeouts: [], playing: false, index: -1, paused: false };
var shuffleOn = false;
var repeatOn = false;

// 曲が最後まで自然に終わった時、シャッフル/リピートの設定に応じて次を決める
function handleSongEnded(finishedIndex) {
  if (repeatOn) {
    if (finishedIndex === 'bonus') { playBonusTrack(); }
    else { playSong(finishedIndex); }
    return;
  }
  if (shuffleOn && library.length > 0) {
    var candidates = library.map(function (_, i) { return i; });
    if (finishedIndex !== 'bonus' && candidates.length > 1) {
      candidates = candidates.filter(function (i) { return i !== finishedIndex; });
    }
    var nextIndex = candidates[Math.floor(Math.random() * candidates.length)];
    playSong(nextIndex);
    return;
  }
  currentPlayback.playing = false;
  renderJukeboxList();
}
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
var activeBonusSeekFillEl = null; // 特典曲のシークバー(進捗表示)への参照

function getElapsedMs() {
  if (playbackState.seeking || currentPlayback.paused) return playbackState.frozenElapsedMs;
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

// 曲名を長押し(スマホ)・クリック(PC)で全文表示する。
// スマホ：長押しで開き、指を離しても表示されたまま。もう一度タップで閉じる。
// PC：クリック＝タップと同じ扱いで、即座に開閉をトグルする。
// 曲名を長押し(スマホ)・クリック(PC)で全文表示する。Studio側でも共有して使う。
export function attachTitleExpand(titleEl, fullName) {
  var expanded = false;
  var moved = false;
  var startX = 0;
  var startY = 0;

  titleEl.style.position = 'relative';
  var originalCss = titleEl.style.cssText;

  function expand() {
    if (expanded) return;
    expanded = true;
    titleEl.style.overflow = 'visible';
    titleEl.style.zIndex = '6';
    titleEl.style.background = 'rgba(20,17,13,0.96)';
    titleEl.style.padding = '4px 8px';
    titleEl.style.margin = '-4px -8px';
    titleEl.style.borderRadius = '4px';
    titleEl.style.whiteSpace = 'nowrap';
    titleEl.style.maxWidth = 'none';
    titleEl.style.width = 'auto';
    titleEl.style.boxShadow = '0 2px 10px rgba(0,0,0,0.5)';
  }
  function collapse() {
    if (!expanded) return;
    expanded = false;
    titleEl.style.cssText = originalCss;
  }
  function toggle() {
    if (expanded) collapse(); else expand();
  }

  titleEl.addEventListener('pointerdown', function (e) {
    e.stopPropagation();
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
  });
  titleEl.addEventListener('pointermove', function (e) {
    if (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8) {
      moved = true; // スクロール等の移動操作は、タップとして扱わない
    }
  });
  titleEl.addEventListener('pointerup', function (e) {
    e.stopPropagation();
    if (moved) return;
    toggle(); // PC・スマホどちらも、タップ/クリックした瞬間に即座にトグルする
  });
  titleEl.addEventListener('pointercancel', function () { moved = true; });
}

// 再生/一時停止ボタンと、停止ボタンのペアを作る
function createPlayPauseStopButtons(isPlaying, isPaused, onPlay, onStop) {
  var wrap = document.createElement('div');
  wrap.style.cssText = "display:flex; gap:6px; flex-shrink:0;";

  var playPauseBtn = document.createElement('div');
  playPauseBtn.style.cssText = "width:26px; height:26px; border-radius:50%; border:1px solid rgba(232,150,66,0.7); display:flex; align-items:center; justify-content:center; color:#efe4cf; font-size:11px; cursor:pointer;";
  playPauseBtn.textContent = (isPlaying && !isPaused) ? 'Ⅱ' : '▶';
  playPauseBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (!isPlaying) { onPlay(); }
    else if (isPaused) { resumePlayback(); }
    else { pausePlayback(); }
  });

  var stopBtn = document.createElement('div');
  var stopEnabled = isPlaying;
  stopBtn.style.cssText = "width:26px; height:26px; border-radius:50%; border:1px solid rgba(232,150,66," + (stopEnabled ? "0.7" : "0.25") + "); display:flex; align-items:center; justify-content:center; color:" + (stopEnabled ? "#efe4cf" : "#6b675e") + "; font-size:10px; cursor:" + (stopEnabled ? "pointer" : "default") + ";";
  stopBtn.textContent = '■';
  stopBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (stopEnabled) onStop();
  });

  wrap.appendChild(playPauseBtn);
  wrap.appendChild(stopBtn);
  return wrap;
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
  attachTitleExpand(bonusTitle, BONUS_TRACK.name);

  var bonusButtons = createPlayPauseStopButtons(bonusPlaying, bonusPlaying && currentPlayback.paused, playBonusTrack, stopJukeboxPlayback);

  var isWaterSkinBonus = getCurrentSkinId() === 'water';
  var bonusSeekTrack = document.createElement('div');
  var bonusSeekFill = document.createElement('div');
  if (isWaterSkinBonus) {
    bonusSeekTrack.style.cssText = "flex-shrink:0; width:70px; height:14px; border-radius:7px; background:rgba(255,255,255,0.06); border:1px solid rgba(200,220,240,0.35); box-shadow:inset 0 1px 2px rgba(255,255,255,0.15); position:relative; overflow:hidden;" + (bonusPlaying ? " cursor:pointer;" : "");
    bonusSeekFill.style.cssText = "position:absolute; top:0; left:0; height:100%; background:" +
      "radial-gradient(ellipse at 20% 30%, rgba(180,215,245,0.7) 0%, rgba(180,215,245,0) 55%)," +
      "radial-gradient(ellipse at 70% 70%, rgba(40,100,190,0.55) 0%, rgba(40,100,190,0) 60%)," +
      "radial-gradient(ellipse at 45% 15%, rgba(210,230,250,0.5) 0%, rgba(210,230,250,0) 50%)," +
      "linear-gradient(180deg, rgba(120,175,230,0.6) 0%, rgba(50,110,200,0.7) 100%);" +
      " width:0%; pointer-events:none; overflow:hidden;";
    bonusSeekTrack.appendChild(bonusSeekFill);
    for (var bbi = 0; bbi < 4; bbi++) {
      var bbubble = document.createElement('div');
      var bbsize = 2 + Math.random() * 2.5;
      bbubble.style.cssText = "position:absolute; width:" + bbsize + "px; height:" + bbsize + "px; border-radius:50%; background:rgba(255,255,255,0.75); left:" + (10 + Math.random() * 80) + "%; top:" + (15 + Math.random() * 65) + "%; animation:seekBubbleSway " + (1.8 + Math.random() * 1.4) + "s ease-in-out " + (-Math.random() * 2) + "s infinite;";
      bonusSeekFill.appendChild(bbubble);
    }
  } else {
    bonusSeekTrack.style.cssText = "flex-shrink:0; width:70px; height:6px; border-radius:3px; background:rgba(169,164,150,0.25); position:relative;" + (bonusPlaying ? " cursor:pointer;" : "");
    bonusSeekFill.style.cssText = "position:absolute; top:0; left:0; height:100%; border-radius:3px; background:rgba(232,150,66,0.85); width:0%; pointer-events:none;";
    bonusSeekTrack.appendChild(bonusSeekFill);
  }

  if (bonusPlaying) {
    activeBonusSeekFillEl = bonusSeekFill;
    if (bonusAudioEl && bonusAudioEl.duration) {
      bonusSeekFill.style.width = Math.max(0, Math.min(100, (bonusAudioEl.currentTime / bonusAudioEl.duration) * 100)) + '%';
    }
    var bonusDragging = false;
    var bonusPosToSec = function (clientX) {
      var rect = bonusSeekTrack.getBoundingClientRect();
      var ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
      return ratio * (bonusAudioEl.duration || 0);
    };
    bonusSeekTrack.addEventListener('pointerdown', function (e) {
      e.stopPropagation();
      bonusDragging = true;
      bonusAudioEl.pause();
      var sec = bonusPosToSec(e.clientX);
      bonusSeekFill.style.width = Math.max(0, Math.min(100, (sec / (bonusAudioEl.duration || 1)) * 100)) + '%';
      try { bonusSeekTrack.setPointerCapture(e.pointerId); } catch (err) {}
    });
    bonusSeekTrack.addEventListener('pointermove', function (e) {
      if (!bonusDragging) return;
      var sec = bonusPosToSec(e.clientX);
      bonusSeekFill.style.width = Math.max(0, Math.min(100, (sec / (bonusAudioEl.duration || 1)) * 100)) + '%';
    });
    var bonusEndDrag = function (e) {
      if (!bonusDragging) return;
      bonusDragging = false;
      var sec = bonusPosToSec(e.clientX);
      bonusAudioEl.currentTime = sec;
      if (currentPlayback.playing && currentPlayback.index === 'bonus' && !currentPlayback.paused) {
        bonusAudioEl.play().catch(function (err) { console.error('resume after seek failed:', err); });
      }
    };
    bonusSeekTrack.addEventListener('pointerup', bonusEndDrag);
    bonusSeekTrack.addEventListener('pointercancel', bonusEndDrag);
  }

  var bonusEndSpacer = document.createElement('div');
  bonusEndSpacer.style.cssText = "flex-shrink:0; width:24px;";

  bonusRow.appendChild(bonusMark);
  bonusRow.appendChild(bonusTitle);
  bonusRow.appendChild(bonusButtons);
  bonusRow.appendChild(bonusSeekTrack);
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
    attachTitleExpand(title, entry.name);

    var playPauseStopBtns = createPlayPauseStopButtons(isPlaying, isPlaying && currentPlayback.paused, function () { playSong(i); }, stopJukeboxPlayback);

    var isWaterSkin = getCurrentSkinId() === 'water';

    var seekBarTrack = document.createElement('div');
    var seekBarFill = document.createElement('div');

    if (isWaterSkin) {
      // 試験管風：外枠はガラスっぽい縁取り、中身は水色のグラデーションで満たす
      seekBarTrack.style.cssText = "flex-shrink:0; width:70px; height:14px; border-radius:7px; background:rgba(255,255,255,0.06); border:1px solid rgba(200,220,240,0.35); box-shadow:inset 0 1px 2px rgba(255,255,255,0.15); position:relative; overflow:hidden;" + (isPlaying ? " cursor:pointer;" : "");
      seekBarFill.style.cssText = "position:absolute; top:0; left:0; height:100%; background:" +
        "radial-gradient(ellipse at 20% 30%, rgba(180,215,245,0.7) 0%, rgba(180,215,245,0) 55%)," +
        "radial-gradient(ellipse at 70% 70%, rgba(40,100,190,0.55) 0%, rgba(40,100,190,0) 60%)," +
        "radial-gradient(ellipse at 45% 15%, rgba(210,230,250,0.5) 0%, rgba(210,230,250,0) 50%)," +
        "linear-gradient(180deg, rgba(120,175,230,0.6) 0%, rgba(50,110,200,0.7) 100%);" +
        " width:0%; pointer-events:none; overflow:hidden;";
      seekBarTrack.appendChild(seekBarFill);

      // 中で揺れ動く小さな気泡
      for (var bi = 0; bi < 4; bi++) {
        var bubble = document.createElement('div');
        var bsize = 2 + Math.random() * 2.5;
        bubble.style.cssText = "position:absolute; width:" + bsize + "px; height:" + bsize + "px; border-radius:50%; background:rgba(255,255,255,0.75); left:" + (10 + Math.random() * 80) + "%; top:" + (15 + Math.random() * 65) + "%; animation:seekBubbleSway " + (1.8 + Math.random() * 1.4) + "s ease-in-out " + (-Math.random() * 2) + "s infinite;";
        seekBarFill.appendChild(bubble);
      }
    } else {
      seekBarTrack.style.cssText = "flex-shrink:0; width:70px; height:6px; border-radius:3px; background:rgba(169,164,150,0.25); position:relative;" + (isPlaying ? " cursor:pointer;" : "");
      seekBarFill.style.cssText = "position:absolute; top:0; left:0; height:100%; border-radius:3px; background:rgba(232,150,66,0.85); width:0%; pointer-events:none;";
      seekBarTrack.appendChild(seekBarFill);
    }

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
    delBtn.addEventListener('click', async function (e) {
      e.stopPropagation();
      var target = library[i];
      var confirmed = await window.showCustomConfirm('「' + (target ? target.name : 'この曲') + '」を削除します。本当によろしいですか？');
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
    row.appendChild(playPauseStopBtns);
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
  currentPlayback.paused = false;
  stopAllNotes(); // 再生中の音をすべて止める
  if (bonusAudioEl) { bonusAudioEl.pause(); bonusAudioEl.currentTime = 0; }
  activeSeekFillEl = null;
  activeBonusSeekFillEl = null;
  renderJukeboxList();
}

// 再生中の曲を一時停止する(位置は保持したまま音だけ止める)
function pausePlayback() {
  if (!currentPlayback.playing || currentPlayback.paused) return;
  currentPlayback.paused = true;
  if (currentPlayback.index === 'bonus') {
    if (bonusAudioEl) bonusAudioEl.pause();
  } else {
    playbackState.frozenElapsedMs = getElapsedMs();
    stopAllNotes();
  }
  renderJukeboxList();
}

// 一時停止していた曲を、止めた位置から再開する
function resumePlayback() {
  if (!currentPlayback.playing || !currentPlayback.paused) return;
  currentPlayback.paused = false;
  if (currentPlayback.index === 'bonus') {
    if (bonusAudioEl) bonusAudioEl.play().catch(function (err) { console.error('resume failed:', err); });
  } else if (playbackState.ctx) {
    playbackState.startCtxTime = playbackState.ctx.currentTime - playbackState.frozenElapsedMs / 1000;
  }
  renderJukeboxList();
}

function playBonusTrack() {
  stopJukeboxPlayback();
  if (!bonusAudioEl) {
    bonusAudioEl = new Audio(BONUS_TRACK.audioUrl);
    bonusAudioEl.addEventListener('ended', function () {
      handleSongEnded('bonus');
    });
    bonusAudioEl.addEventListener('timeupdate', function () {
      if (!activeBonusSeekFillEl || !bonusAudioEl.duration) return;
      var pct = Math.max(0, Math.min(100, (bonusAudioEl.currentTime / bonusAudioEl.duration) * 100));
      activeBonusSeekFillEl.style.width = pct + '%';
    });
  }
  currentPlayback.playing = true;
  currentPlayback.index = 'bonus';
  currentPlayback.paused = false;
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
  currentPlayback.paused = false;
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
  if (!currentPlayback.playing || playbackState.seeking || currentPlayback.paused) return;
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
    handleSongEnded(currentPlayback.index);
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

// 同じ名前が既にある場合、「name (2)」「name (3)」...と、空いている番号を探す
function findAvailableSongName(baseName, existingNames) {
  var n = 2;
  while (existingNames.indexOf(baseName + ' (' + n + ')') !== -1) { n++; }
  return baseName + ' (' + n + ')';
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

      var baseName = file.name.replace(/\.[^/.]+$/, '');

      // ---- Jukebox側の重複チェック(独立管理のため、Studio側とは別に判定する) ----
      var jukeboxExistingNames = library.map(function (e) { return e.name; });
      var jukeboxFinalName = baseName;
      if (jukeboxExistingNames.indexOf(baseName) !== -1) {
        var suggestedJukebox = findAvailableSongName(baseName, jukeboxExistingNames);
        var confirmedJukebox = await window.showCustomConfirm(
          'Jukeboxに収録した曲に、同名の曲「' + baseName + '」が既にあります。\n' +
          '「' + suggestedJukebox + '」として保存しますか？'
        );
        jukeboxFinalName = confirmedJukebox ? suggestedJukebox : null; // nullはこちらへの保存を見送る印
      }

      // ---- Studio側の重複チェック(独立管理のため、Jukebox側とは別に判定する) ----
      var studioSongsNow = await studioDB.getAllSongs().catch(function () { return []; });
      var studioExistingNames = studioSongsNow.map(function (e) { return e.name; });
      var studioFinalName = baseName;
      if (studioExistingNames.indexOf(baseName) !== -1) {
        var suggestedStudio = findAvailableSongName(baseName, studioExistingNames);
        var confirmedStudio = await window.showCustomConfirm(
          'Studioに収録した曲に、同名の曲「' + baseName + '」が既にあります。\n' +
          '「' + suggestedStudio + '」として保存しますか？'
        );
        studioFinalName = confirmedStudio ? suggestedStudio : null;
      }

      if (jukeboxFinalName === null && studioFinalName === null) {
        showImportStatus('取り込みをキャンセルしました', true);
        return;
      }

      // JukeboxとStudioは別管理(別レコード)にするため、それぞれに独立した複製を保存する。
      // 片方を削除してももう片方には影響しない。名前が異なる結果になることもある。
      if (jukeboxFinalName !== null) {
        var entry = {
          name: jukeboxFinalName,
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
          console.error('save failed(jukebox):', err);
          library.push(entry);
          renderJukeboxList();
        });
      }

      if (studioFinalName !== null) {
        var studioEntry = {
          name: studioFinalName,
          songData: parsed.notes,
          durationMs: parsed.durationMs,
          gainCompensation: gainCompensation,
          scoreHistory: []
        };
        studioDB.saveSong(studioEntry).catch(function (err) {
          console.error('save failed(studio):', err);
        });
      }

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

  // ---- シャッフル・リピートボタン ----
  var randomBtn = document.getElementById('jukebox-random-btn');
  var repeatBtn = document.getElementById('jukebox-repeat-btn');
  var LIT_COLOR = '#e8a24a';
  var DIM_COLOR = '#6b675e';
  randomBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    shuffleOn = !shuffleOn;
    randomBtn.style.color = shuffleOn ? LIT_COLOR : DIM_COLOR;
  });
  repeatBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    repeatOn = !repeatOn;
    repeatBtn.style.color = repeatOn ? LIT_COLOR : DIM_COLOR;
  });

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
// Studio側からも同じ演出を使うため、exportして共有する
var bgmFadeRaf = null;
export function fadeBgm(targetVolume, durationMs) {
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

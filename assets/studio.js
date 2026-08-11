// assets/studio.js
// Studio（GAME ON）画面。現時点では水（バブル）スキンのみ実装。
// 見た目確認用のダミーノーツを表示する段階で、実際のMIDI連動はまだ行っていない。

import { getCurrentSkinId, getSkinPartId } from './skin.js';
import { studioDB, fadeBgm, attachTitleExpand } from './jukebox.js';
import { playNote, getPianoCtx, loadPianoSamples, stopAllNotes } from './audio-engine.js';

var LANES = 6;
var laneStates = [];
var built = false;
var loopStarted = false;
var FALL_DURATION_MS = 2600; // ノーツが上端から鍵盤に届くまでの時間
var KEYS_TOTAL_HEIGHT = 218; // 鍵盤の高さ(208px) + 下余白(10px)
var JUDGE_LINE_OFFSET = 35;  // 鍵盤上端から判定ライン(実線/Justの中心)までの距離(px)。下点線が鍵盤上5pxに来るよう、HIT_WINDOW_PX(30)+5
var HIT_WINDOW_PX = 30;      // 判定ラインからこの距離以内なら、とにかく「ヒット」として認める(これより離れた早いタップ等は無効)
var JUST_WINDOW_PX = 36;     // 判定ラインからこの距離以内なら「Just」(ジャストタイミング)。当たり判定を広めに取るため、通常の3倍(12→36)にしてある
var HOLD_THRESHOLD_MS = 350; // これより長い音符は「押しっぱなし」が必要なホールドノーツとして扱う
var BUBBLE_MAX_RISE_PX = 200; // 泡は当たり判定に必須ではなく見た目の演出のため、衝突しなくてもこの距離まで昇ったら消える(画面上部まで昇り続けるのを防ぐ)

// ノーツの現在位置が、判定ラインからどれだけ離れているかで判定する。
// 'just'=ジャストタイミング、'hit'=普通のヒット、null=まだ早い/もう遅い(判定なし)
// ★ 見た目の判定枠(点線=HIT_WINDOW_PX)より外側では、どんなにJustの許容距離(JUST_WINDOW_PX)が
//   広くても判定しない。「押しっぱなしにしていると、枠の外(まだ上の方)でノーツが
//   一瞬表示されてすぐ消える」という見た目のズレを防ぐため、判定の上限は必ず
//   見た目の枠(HIT_WINDOW_PX)に合わせる。
function judgeNoteHit(record, areaHeight) {
  var lineY = areaHeight - JUDGE_LINE_OFFSET;
  var noteBottom = record.y + record.height;
  var dist = Math.abs(noteBottom - lineY);
  if (dist > HIT_WINDOW_PX) return null; // 見た目の枠の外側は、問答無用でまだ/もう判定しない
  if (dist <= JUST_WINDOW_PX) return 'just';
  return 'hit';
}

// ホールドノーツの上端(=音の終わり)が判定ラインを過ぎたかどうか。押しっぱなしを最後までできたかの判定に使う
function isHoldFullyPassed(record, areaHeight) {
  var lineY = areaHeight - JUDGE_LINE_OFFSET;
  return record.y >= lineY;
}

// ノーツへのヒットが発生した瞬間の共通処理(タップ・泡衝突・鍵盤直接判定、すべてここを通す)
function attemptHit(record, area, judgment) {
  if (record.popped || record.holding) return false;
  if (record.isHold) {
    // ホールドノーツ：即座には消さず、「押しっぱなしで正しく保持している」状態にする
    record.holding = true;
    record.el.classList.add('holding');
    playHitFeedback(record, judgment);
    if (judgment === 'just') {
      var rect = record.el.getBoundingClientRect();
      var areaRect = area.getBoundingClientRect();
      var popup = document.createElement('div');
      popup.className = 'studio-just-popup';
      popup.textContent = 'JUST';
      popup.style.left = (rect.left - areaRect.left + rect.width / 2) + 'px';
      popup.style.top = (rect.top - areaRect.top + rect.height / 2) + 'px';
      area.appendChild(popup);
      popup.addEventListener('animationend', function () { popup.remove(); });
    }
  } else {
    record.popped = true;
    popNote(record.el, area, record, judgment);
  }
  return true;
}

// ホールドノーツを最後まで正しく保持できた時(上端が判定ラインを通過した瞬間)
function finishHold(record, area) {
  record.popped = true;
  addScore(SCORE_PER_HIT); // 最後まで保持できたボーナス(音・初動のスコアは既にattemptHitで加算済み)
  popNote(record.el, area, record, null, { skipAudioScore: true });
}

// ホールドノーツを最後まで保持できず、途中で指を離してしまった時(残りは得点にならない)
function abortHold(record) {
  record.popped = true;
  record.el.style.transition = 'opacity 0.25s ease-out';
  record.el.style.opacity = '0';
  (function (el) { setTimeout(function () { if (el.parentNode) el.remove(); }, 260); })(record.el);
  currentSong.accuracyHistory.push(0);
}



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
    laneStates[i].keyEl = key; // 泡の当たり判定で「押している間かどうか」を見るために保持

    lane.appendChild(fallArea);
    lane.appendChild(key);
    playfield.appendChild(lane);
  }

  // 装飾用の黒鍵は、曲の実際の音階が分かってから配置する(updateBlackKeys参照)
  var blackKeysLayer = document.createElement('div');
  blackKeysLayer.className = 'studio-black-keys-layer';
  blackKeysLayer.id = 'studio-black-keys-layer';
  document.getElementById('scene-studio-play').appendChild(blackKeysLayer);

  // 当たり判定ライン：下から「点線(Hitゾーン下端)・実線(Justの中心)・点線(Hitゾーン上端)」の3本
  // 実線のタイミングで鍵盤をタップするとJustになる。点線2本はHIT_WINDOW_PXぶん外側の目安線。
  var judgeLineLowerEl = document.createElement('div');
  judgeLineLowerEl.className = 'studio-hitzone-line-dashed';
  judgeLineLowerEl.style.bottom = (KEYS_TOTAL_HEIGHT + JUDGE_LINE_OFFSET - HIT_WINDOW_PX) + 'px';
  document.getElementById('scene-studio-play').appendChild(judgeLineLowerEl);

  var judgeLineEl = document.createElement('div');
  judgeLineEl.className = 'studio-hitzone-line';
  judgeLineEl.style.bottom = (KEYS_TOTAL_HEIGHT + JUDGE_LINE_OFFSET) + 'px';
  document.getElementById('scene-studio-play').appendChild(judgeLineEl);

  var judgeLineUpperEl = document.createElement('div');
  judgeLineUpperEl.className = 'studio-hitzone-line-dashed';
  judgeLineUpperEl.style.bottom = (KEYS_TOTAL_HEIGHT + JUDGE_LINE_OFFSET + HIT_WINDOW_PX) + 'px';
  document.getElementById('scene-studio-play').appendChild(judgeLineUpperEl);

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

  // ---- 鍵盤から出る炎(炎スキン限定)。粒をいくつも飛ばすのではなく、
  //      押している間ずっと1本の炎が存在し続ける、火炎放射器のイメージ ----
  var activeFlames = {}; // laneIndex -> 炎のDOM要素
  function showFlamethrower(fallArea, laneIndex) {
    if (activeFlames[laneIndex]) return; // 既に出ていれば何もしない
    var f = document.createElement('div');
    f.className = 'studio-flamethrower';
    fallArea.appendChild(f);
    requestAnimationFrame(function () { f.classList.add('lit'); }); // 一呼吸おいて伸ばす(ぼうっと出る感じ)
    activeFlames[laneIndex] = f;
  }
  function hideFlamethrower(laneIndex) {
    var f = activeFlames[laneIndex];
    if (!f) return;
    f.classList.remove('lit');
    f.classList.add('extinguish');
    setTimeout(function () { if (f.parentNode) f.remove(); }, 200);
    delete activeFlames[laneIndex];
  }
  // 炎が届く範囲(鍵盤上端からのpx)にいる、まだ弾けていないノーツを燃やす
  var FLAME_REACH_PX = 90;
  function tryBurnNoteInFlame(fallArea, laneIndex) {
    var areaHeight = fallArea.clientHeight;
    if (!areaHeight) return; // まだレイアウトが確定していない一瞬は、誤判定を避けるため何もしない
    var state = laneStates[laneIndex];
    for (var i = 0; i < state.notes.length; i++) {
      var record = state.notes[i];
      if (record.popped || record.holding) continue;
      if (record.y + record.height >= areaHeight - FLAME_REACH_PX) {
        var judgment = judgeNoteHit(record, areaHeight);
        attemptHit(record, fallArea, judgment || 'hit'); // 炎が届いてさえいれば燃える(タイミングはシビアにしない)
        return;
      }
    }
  }

  // 鍵盤付近にいる、まだ弾けていないノーツを直接叩く(ノーマルスキン用)。判定ライン基準で判定する
  function tryHitNearestNote(fallArea, laneIndex) {
    var areaHeight = fallArea.clientHeight;
    if (!areaHeight) return; // まだレイアウトが確定していない一瞬は、誤判定を避けるため何もしない
    var state = laneStates[laneIndex];
    for (var i = 0; i < state.notes.length; i++) {
      var record = state.notes[i];
      if (record.popped || record.holding) continue;
      var judgment = judgeNoteHit(record, areaHeight);
      if (judgment) {
        attemptHit(record, fallArea, judgment);
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
      var keyEffectSkin = getSkinPartId('keyEffect');
      if (keyEffectSkin === 'fire') showFlamethrower(fallArea, laneIndex);
      (function loopPressed() {
        if (!key.classList.contains('pressed')) {
          pressedLoopId = null;
          if (getSkinPartId('keyEffect') === 'fire') hideFlamethrower(laneIndex);
          return;
        }
        var currentKeyEffect = getSkinPartId('keyEffect');
        if (currentKeyEffect === 'fire') {
          tryBurnNoteInFlame(fallArea, laneIndex); // 炎が届く範囲のノーツを燃やし続ける
        } else if (currentKeyEffect === 'water') {
          spawnRisingBubble(fallArea, laneIndex); // 水スキン：泡は見た目の演出として立ち上らせる
          tryHitNearestNote(fallArea, laneIndex); // 判定自体は他スキンと同じ直接判定にして、枠内なら確実にヒットさせる(泡の衝突有無に左右されない)
        } else {
          tryHitNearestNote(fallArea, laneIndex); // 指定がなければノーマル：炎・泡なし、直接ヒット判定
        }
        pressedLoopId = setTimeout(loopPressed, 60);
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
    '<div id="studio-abort-btn" class="studio-abort-btn">中断</div>' +
    '<div style="flex:1;"></div>' +
    '<div class="studio-score-key-spacer"></div>';
  playfield.appendChild(scorePanel);

  document.getElementById('studio-abort-btn').addEventListener('click', async function (e) {
    e.stopPropagation();
    pauseSongPlayback(); // 押した瞬間に、音・ノーツの動きをすべて止める
    var confirmed = await window.showCustomConfirm('演奏を中断します。終了しますか？');
    if (confirmed) {
      closeStudioPlay();
    } else {
      resumeSongPlayback(); // キャンセルしたら、止めていた分を補正して再開する
    }
  });

  // ---- デバッグ用：Studio内の全ノーツを常にJustタイミングで自動ヒットさせる ----
  // ブラウザのコンソールから `PianoWorksDebug.setAutoJust(true)` で有効化できる。
  // 実際に叩く必要がなくなるので、譜面が正しく流れているか・スコア処理側のバグかを切り分けたい時などに使う。
  var debugAutoJust = false;
  function debugForceJustAllNotes() {
    laneStates.forEach(function (state, laneIndex) {
      var fallArea = document.getElementById('studio-fall-' + laneIndex);
      if (!fallArea) return;
      state.notes.forEach(function (record) {
        if (record.popped) return;
        if (record.holding) {
          finishHold(record, fallArea); // ホールド中のものは、実際に押さえ続けなくても即座に最後まで成功させる
          return;
        }
        attemptHit(record, fallArea, 'just');
        if (record.holding) {
          // isHoldのノーツはattemptHitで「保持中」状態になるだけなので、デバッグ用にそのまま完了までさせる
          finishHold(record, fallArea);
        }
      });
    });
  }
  if (typeof window !== 'undefined') {
    window.PianoWorksDebug = window.PianoWorksDebug || {};
    window.PianoWorksDebug.setAutoJust = function (on) {
      debugAutoJust = !!on;
      console.log('[PianoWorksDebug] autoJust =', debugAutoJust);
    };
    // ?debugAutoJust=1 をURLに付けて開いても有効化できる(コンソールを開きにくいモバイル実機向け)
    try {
      if (new URLSearchParams(window.location.search).get('debugAutoJust') === '1') {
        debugAutoJust = true;
      }
    } catch (e) { /* URLSearchParams非対応環境は無視 */ }
  }

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
    if (currentSong.paused) dt = 0; // 一時停止中はノーツ・泡の動きを止める(時計だけは進めない)
    if (debugAutoJust) debugForceJustAllNotes();

    laneStates.forEach(function (state, laneIndex) {
      var fallArea = document.getElementById('studio-fall-' + laneIndex);
      if (!fallArea) return;
      var areaHeight = fallArea.clientHeight;
      if (!areaHeight) return; // まだレイアウトが確定していない一瞬は、誤判定を避けるためこのフレームは何もしない(次フレームで再試行される)

      state.notes.forEach(function (record) {
        if (record.popped) return;
        record.y += record.speed * dt;
        if (record.holding) {
          // ホールド中：上端(音の終わり)が判定ラインを過ぎたら完了、鍵盤が離されていたら中断する
          if (isHoldFullyPassed(record, areaHeight)) {
            finishHold(record, fallArea);
          } else if (!(activeKey && parseInt(activeKey.dataset.lane, 10) === laneIndex)) {
            abortHold(record);
          }
          record.el.style.transform = 'translateY(' + record.y + 'px)';
          return;
        }

        var distToBottom = areaHeight - (record.y + record.height);
        if (distToBottom < 0) distToBottom = 0;

        // PC版と同じ考え方：判定ゾーン(実線±HIT_WINDOW_PX)を通過するあいだに連続的に薄くなり、
        // ゾーンを抜けきったところ(=もうヒットしようがない位置)で初めて取りこぼし確定・消去する
        var fadeStart = JUDGE_LINE_OFFSET + HIT_WINDOW_PX; // ここからフェード開始
        var fadeEnd = JUDGE_LINE_OFFSET - HIT_WINDOW_PX;   // ここでopacity 0(=ヒット判定が可能な範囲の終わり)

        if (distToBottom <= fadeStart) {
          var ratio = (distToBottom - fadeEnd) / (fadeStart - fadeEnd);
          record.el.style.opacity = Math.max(0, Math.min(1, ratio));
        }
        if (distToBottom <= fadeEnd) {
          record.popped = true;
          currentSong.accuracyHistory.push(0);
          (function (el) { if (el.parentNode) el.remove(); })(record.el);
          return;
        }
        record.el.style.transform = 'translateY(' + record.y + 'px)';
      });

      state.bubbles.forEach(function (b) {
        b.risen += b.speed * dt;
        b.el.style.bottom = b.risen + 'px';
        // 衝突しなくても、最大上昇距離が近づいたら徐々に薄くして自然に消す
        var fadeZone = 40;
        if (b.risen > BUBBLE_MAX_RISE_PX - fadeZone) {
          var bubbleOpacity = 1 - (b.risen - (BUBBLE_MAX_RISE_PX - fadeZone)) / fadeZone;
          b.el.style.opacity = Math.max(0, Math.min(1, bubbleOpacity));
        }
      });

      state.bubbles.forEach(function (b) {
        if (b.consumed) return;
        // 鍵盤を離している間は、泡が触れても判定しない(見た目の上昇はそのまま続ける)
        var isKeyPressed = state.keyEl && state.keyEl.classList.contains('pressed');
        if (!isKeyPressed) return;
        var bubbleTopY = areaHeight - b.risen - b.size;
        state.notes.forEach(function (record) {
          if (record.popped || record.holding) return;
          if (bubbleTopY <= record.y + record.height && bubbleTopY + b.size >= record.y) {
            var judgment = judgeNoteHit(record, areaHeight);
            if (judgment) {
              b.consumed = true;
              attemptHit(record, fallArea, judgment);
            }
            // 判定ラインから離れすぎている場合は、泡が触れても弾けない(すり抜ける)
          }
        });
      });

      state.bubbles = state.bubbles.filter(function (b) {
        if (b.consumed || b.risen > BUBBLE_MAX_RISE_PX) {
          if (b.el.parentNode) b.el.remove();
          return false;
        }
        return true;
      });

      state.notes = state.notes.filter(function (record) { return !record.popped; });
    });

    // 音・見た目のノーツ生成が両方とも終わり、画面上にノーツが1つも残っていなければ、曲は完了
    if (currentSong.playing && !currentSong.paused &&
        currentSong.audioIntervalId === null && currentSong.chartIntervalId === null) {
      var anyNotesLeft = laneStates.some(function (state) { return state.notes.length > 0 || state.bubbles.length > 0; });
      if (!anyNotesLeft) {
        currentSong.playing = false; // 二重に呼ばれないよう先に倒しておく
        closeStudioPlay(); // フェードで一覧に戻る(内部でstopSongPlayback→最高スコア保存も行われる)
      }
    }

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
// 音を鳴らし、スコアを加算する(二重に鳴らないよう、ヒット処理全体でここ1箇所だけが担当する)
function playHitFeedback(record, judgment) {
  if (!record || record.pitch == null) return;
  var v = Math.max(1, Math.min(100, record.velocity * (record.gainCompensation || 1)));
  playNote(record.pitch, v, record.duration);
  addScore(judgment === 'just' ? SCORE_PER_HIT * 2 : SCORE_PER_HIT);
  currentSong.accuracyHistory.push(judgment === 'just' ? 100 : 70);
}

function popNote(note, area, record, judgment, opts) {
  if (note.classList.contains('popping')) return;
  var skipAudioScore = opts && opts.skipAudioScore; // ホールド完了時など、既に音・スコアを処理済みの場合はtrue
  if (!skipAudioScore) {
    playHitFeedback(record, judgment);
  }
  var rect = note.getBoundingClientRect();
  var areaRect = area.getBoundingClientRect();
  var cx = rect.left - areaRect.left + rect.width / 2;
  var cy = rect.top - areaRect.top + rect.height / 2;

  if (judgment === 'just') {
    var popup = document.createElement('div');
    popup.className = 'studio-just-popup';
    popup.textContent = 'JUST';
    popup.style.left = cx + 'px';
    popup.style.top = cy + 'px';
    area.appendChild(popup);
    popup.addEventListener('animationend', function () { popup.remove(); });
  }

  note.classList.add('popping');
  var skinId = getSkinPartId('keyEffect'); // ヒット時の演出も「鍵盤を押した時のエフェクト」の一部として扱う

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
  } else if (skinId === 'fire') {
    // 炎スキン：燃え上がる閃光+火の粉が舞い散る演出("燃やして灰にする")
    var flash = document.createElement('div');
    flash.className = 'studio-burn-flash';
    var flashSize = Math.max(rect.width, rect.height) * 1.3;
    flash.style.width = flashSize + 'px';
    flash.style.height = flashSize + 'px';
    flash.style.left = cx + 'px';
    flash.style.top = cy + 'px';
    flash.style.animation = 'studioBurnFlash 0.4s ease-out forwards';
    area.appendChild(flash);
    flash.addEventListener('animationend', function () { flash.remove(); });

    var ashCount = 7 + Math.floor(Math.random() * 5);
    for (var e = 0; e < ashCount; e++) {
      var ash = document.createElement('div');
      ash.className = 'studio-ash';
      var esize = 3 + Math.random() * 4;
      ash.style.width = esize + 'px';
      ash.style.height = esize + 'px';
      ash.style.left = (cx - esize / 2 + (Math.random() - 0.5) * rect.width) + 'px';
      ash.style.top = (cy - esize / 2) + 'px';

      var eDist = 10 + Math.random() * 18;
      ash.style.setProperty('--dx', ((Math.random() - 0.5) * eDist).toFixed(1) + 'px');
      ash.style.setProperty('--dy', (18 + Math.random() * 22).toFixed(1) + 'px'); // 灰は下にゆっくり舞い落ちる
      ash.style.setProperty('--rot', (Math.random() * 180 - 90) + 'deg');
      var eDur = 0.6 + Math.random() * 0.4;
      ash.style.animation = 'studioAshFall ' + eDur.toFixed(2) + 's ease-out forwards';

      area.appendChild(ash);
      (function (el) { el.addEventListener('animationend', function () { el.remove(); }); })(ash);
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
// PC版と同じ考え方：直近10プレイ分(playHistory)を、常に10分割固定の目盛りに描画する。
// まだプレイしていない区画は0%として扱い(星は打たない)、常に10区画ぶんの折れ線を描く。
// タップ判定用に、実際に星を描いた位置を配列で返す。
function drawSparkline(canvas, playHistory) {
  playHistory = playHistory || [];
  var ctx = canvas.getContext('2d');
  var dpr = window.devicePixelRatio || 1;
  var rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  var w = rect.width, h = rect.height;
  ctx.clearRect(0, 0, w, h);

  var labelWidth = 20;
  var sidePad = 6;
  var bottomPad = 4;
  var topPad = 4;
  var usableHeight = h - topPad - bottomPad;
  var usableWidth = w - labelWidth - sidePad;

  // 0/20/40/60/80/100%の目盛り線とラベル(PC版と同じ)
  var gridValues = [0, 20, 40, 60, 80, 100];
  ctx.strokeStyle = 'rgba(169,164,150,0.35)';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 2]);
  gridValues.forEach(function (v) {
    var y = h - bottomPad - (v / 100) * usableHeight;
    ctx.beginPath();
    ctx.moveTo(labelWidth, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  });
  ctx.setLineDash([]);

  ctx.fillStyle = 'rgba(169,164,150,0.7)';
  ctx.font = '8px sans-serif';
  ctx.textBaseline = 'middle';
  gridValues.forEach(function (v) {
    var y = h - bottomPad - (v / 100) * usableHeight;
    ctx.fillText(v + '%', 0, y);
  });

  var MAX_SLOTS = 10;
  var stepX = usableWidth / (MAX_SLOTS - 1);
  var values = [];
  for (var i = 0; i < MAX_SLOTS; i++) {
    values.push(playHistory[i] ? playHistory[i].accuracy : 0);
  }

  // 折れ線(PC版と同じ配色。常に10点を結ぶので、プレイ回数によらず必ず線が引ける)
  ctx.strokeStyle = '#b87333';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  values.forEach(function (v, i) {
    var x = labelWidth + sidePad + i * stepX;
    var y = h - bottomPad - (v / 100) * usableHeight;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // 実際にプレイした点にだけ星マーカーを打つ(未プレイの区画には打たない)
  var starPositions = [];
  ctx.fillStyle = '#ffdd55';
  ctx.strokeStyle = '#b87333';
  ctx.lineWidth = 1;
  values.forEach(function (v, i) {
    if (i >= playHistory.length) return; // 未プレイ区画はスキップ
    var x = labelWidth + sidePad + i * stepX;
    var y = h - bottomPad - (v / 100) * usableHeight;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    starPositions.push({ x: x, y: y, index: i });
  });

  return starPositions; // タップ判定に使う、実際にプレイした点の画面座標(CSSピクセル)
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

      var noEl = document.createElement('div');
      noEl.style.cssText = "font-family:'Yomogi', cursive; font-size:12px; color:#a99f8c; width:20px; flex-shrink:0;";
      noEl.textContent = (i + 1);

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

      var detailBtn = document.createElement('div');
      detailBtn.style.cssText = "flex-shrink:0; font-family:'Yomogi', cursive; font-size:12px; color:#a99f8c; padding:4px 8px; border:1px solid rgba(169,164,150,0.4); border-radius:5px; cursor:pointer; white-space:nowrap;";
      detailBtn.textContent = '詳細';
      detailBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openStudioDetail(entry);
      });

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

      row.appendChild(noEl);
      row.appendChild(title);
      row.appendChild(playBtn);
      row.appendChild(detailBtn);
      row.appendChild(delBtn);
      list.appendChild(row);
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

  var whiteKeys = Array.prototype.slice.call(document.querySelectorAll('.studio-key'));

  // 白鍵・黒鍵を一旦透明にしてから、新しい黒鍵の配置に差し替え、同時にフェードインさせる
  layer.style.opacity = '0';
  whiteKeys.forEach(function (k) { k.style.opacity = '0'; });

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

  requestAnimationFrame(function () {
    requestAnimationFrame(function () { // 1フレームだけだとopacity:0が反映されないブラウザがあるため、2フレーム待つ
      layer.style.opacity = '1';
      whiteKeys.forEach(function (k) { k.style.opacity = '1'; });
    });
  });
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
  playing: false,
  paused: false,
  pauseStartRealTime: 0,
  score: 0,
  lastFishMilestone: 0,
  entryId: null,
  entryMaxScore: 0,
  accuracyHistory: [] // 1回のプレイの中で、叩くたびの正確さ(0/60/70/80/90/100)を記録する
};

var SCORE_PER_HIT = 100;
var FISH_MILESTONE = 1000; // このスコアを超えるたびに、魚を1匹泳がせる

function addScore(points) {
  currentSong.score += points;
  var el = document.getElementById('studioScoreValue');
  if (el) el.textContent = currentSong.score;

  if (getCurrentSkinId() === 'water') {
    var milestone = Math.floor(currentSong.score / FISH_MILESTONE);
    if (milestone > currentSong.lastFishMilestone) {
      currentSong.lastFishMilestone = milestone;
      spawnBackgroundFish();
    }
  }
}

// スコアが伸びると、背景に魚を1匹泳がせる(水スキン限定。ノーツの邪魔にならないよう最背面に配置)
function spawnBackgroundFish() {
  var playfield = document.getElementById('studio-playfield');
  if (!playfield) return;
  var fish = document.createElement('div');
  fish.className = 'studio-bg-fish';
  var fromLeft = Math.random() < 0.5;
  if (!fromLeft) fish.classList.add('flipped');

  var topPct = 15 + Math.random() * 60; // 縦位置はランダム(判定ライン付近は避けて上寄りにしておく)
  fish.style.top = topPct + '%';
  fish.style.left = fromLeft ? '-40px' : 'auto';
  fish.style.right = fromLeft ? 'auto' : '-40px';

  fish.innerHTML = '<div class="fish-body"></div><div class="fish-tail"></div>';
  playfield.appendChild(fish);

  var playfieldWidth = playfield.clientWidth || 360;
  var duration = 7 + Math.random() * 3;
  fish.style.transition = 'left ' + duration + 's linear, right ' + duration + 's linear';
  requestAnimationFrame(function () {
    if (fromLeft) fish.style.left = (playfieldWidth + 40) + 'px';
    else fish.style.right = (playfieldWidth + 40) + 'px';
  });
  setTimeout(function () { if (fish.parentNode) fish.remove(); }, duration * 1000 + 200);
}

// 中断ボタンを押した瞬間などに、音・ノーツの動きをすべて即座に止める(まだ完全終了はしない)
function pauseSongPlayback() {
  if (!currentSong.playing || currentSong.paused) return;
  currentSong.paused = true;
  // ctx.currentTimeは、一時停止中にAudioContextがサスペンドすると信頼できなくなるため、
  // 実時間(壁時計)のperformance.now()で一時停止していた時間を測る(PC版とは違う対策だが、
  // 「サスペンド明けを確実に検知して起こす」という考え方はPC版のplayNoteに合わせている)
  currentSong.pauseStartRealTime = performance.now();
  stopAllNotes(); // 今鳴っている音も止める
}

// 一時停止していた演奏を、止めていた分の時間のズレを補正しながら再開する
function resumeSongPlayback() {
  if (!currentSong.playing || !currentSong.paused) return;
  var ctx = currentSong.ctx;

  function finishResume() {
    var pausedDurationMs = performance.now() - currentSong.pauseStartRealTime;
    currentSong.startCtxTime += pausedDurationMs / 1000; // 止めていた分だけ基準時刻をずらし、飛び進むのを防ぐ
    currentSong.paused = false;
  }

  // 一時停止中にAudioContextがサスペンドしていることがあるため、
  // 再開を確実に待ってから、演奏を再開したことにする(音が鳴らない・遅れる対策)
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().then(finishResume).catch(function (err) {
      console.error('resume failed:', err);
      finishResume(); // 失敗しても、演奏自体は止めたままにしないよう進める
    });
  } else {
    finishResume();
  }
}

function stopSongPlayback() {
  currentSong.playing = false;
  currentSong.paused = false; // 中断→終了で止めたまま残ると、次回の再生が始まらなくなるためリセットする
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
  return saveMaxScoreIfNeeded();
}

// 中断・完了に関わらず、今回のプレイの記録(スコア・accuracy・日時)を保存する
function saveMaxScoreIfNeeded() {
  if (currentSong.entryId == null) return Promise.resolve();
  if (currentSong.accuracyHistory.length === 0) return Promise.resolve(); // 一度も叩かないまま終わった場合は保存しない
  var newScore = currentSong.score;
  // PC版のhitAccuracyと同じ考え方：このプレイで叩いた1音ずつの正確さ(0/70/100)の平均を、
  // このプレイ全体の正確さ(%)とする
  var sum = currentSong.accuracyHistory.reduce(function (a, b) { return a + b; }, 0);
  var newAccuracy = sum / currentSong.accuracyHistory.length;
  return studioDB.getAllSongs().then(function (songs) {
    var target = songs.filter(function (s) { return s.id === currentSong.entryId; })[0];
    if (!target) return;
    // PC版と同じく「1プレイ=1点」としてplayHistoryに積み重ね、直近10件だけ保持する
    // (先頭が一番古いプレイ、末尾が最新のプレイ)
    var prevPlayHistory = target.playHistory || [];
    var playHistory = prevPlayHistory.concat([{
      date: Date.now(),
      score: newScore,
      accuracy: newAccuracy
    }]).slice(-10);
    target.playHistory = playHistory;
    if (newScore > (target.maxScore || 0)) {
      target.maxScore = newScore;
    }
    return studioDB.updateSong(target);
  }).catch(function (err) { console.error('score save failed:', err); });
}

// 見た目のノーツを1つ生成し、上端から鍵盤へ向けて落とし始める
function spawnRealNote(entry) {
  var area = document.getElementById('studio-fall-' + entry.lane);
  if (!area) return;
  var skinId = getSkinPartId('notes');
  var note = document.createElement('div');

  var pitchNorm = entry.lane / (LANES - 1);
  var height = (28 + Math.random() * 10) * (1.15 - pitchNorm * 0.35);
  var durSec = Math.max(0.05, (entry.duration || 250) / 1000);
  if (durSec > 0.6) { height *= Math.min(4.5, 1 + durSec); } // 長い音符は縦長にする
  var inset = 6 + Math.random() * 6;
  note.style.left = inset + 'px';
  note.style.right = inset + 'px';
  note.style.height = height + 'px';
  note.style.top = '0';
  note.style.transform = 'translateY(' + (-height) + 'px)';

  if (skinId === 'normal' || skinId === 'fire') {
    // ノーマルスキンと共通の見た目。塗りつぶしの長方形、白鍵は黄金色、黒鍵は紫色
    note.className = 'studio-note skin-normal';
    var semitone = ((entry.pitch % 12) + 12) % 12;
    var isBlackKey = !!SHARP_SEMITONES[semitone];
    note.style.backgroundColor = isBlackKey
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

  // レイアウトがまだ確定しておらずclientHeightが0の場合、決め打ちの数値ではなく
  // 画面全体(scene-studio-play)の高さを代わりに使う(実際の落下エリアに近い値になるよう、なるべく正確に見積もる)
  var areaHeight = area.clientHeight
    || (document.getElementById('scene-studio-play') || {}).clientHeight
    || window.innerHeight;
  var record = {
    el: note,
    y: -height,
    height: height,
    speed: areaHeight / (FALL_DURATION_MS / 1000),
    popped: false,
    holding: false,
    isHold: (entry.duration || 0) > HOLD_THRESHOLD_MS,
    lane: entry.lane,
    pitch: entry.pitch,
    velocity: entry.velocity,
    duration: entry.duration,
    gainCompensation: currentSong.gainCompensation
  };
  laneStates[entry.lane].notes.push(record);

  note.addEventListener('pointerdown', function (ev) {
    ev.stopPropagation();
    if (record.popped || record.holding) return;
    var judgment = judgeNoteHit(record, areaHeight);
    if (judgment) {
      attemptHit(record, area, judgment);
    }
    // 判定ラインから離れすぎている場合は、タップしても何も起きない(タイミングを合わせる必要がある)
  });
}

// 20ms間隔で「今の再生位置」をチェックし、その瞬間の音符だけを鳴らす(音声・Jukeboxと同じ考え方)
function startAudioScheduler() {
  var ctx = currentSong.ctx;
  function tick() {
    if (!currentSong.playing || currentSong.paused) return;
    var elapsedMs = (ctx.currentTime - currentSong.startCtxTime) * 1000;
    var notes = currentSong.audioNotes;
    while (currentSong.audioIndex < notes.length && notes[currentSong.audioIndex].time <= elapsedMs) {
      var n = notes[currentSong.audioIndex];
      var v = Math.max(1, Math.min(100, n.velocity * currentSong.gainCompensation));
      playNote(n.pitch, v, n.duration);
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
    if (!currentSong.playing || currentSong.paused) return;
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
  bubble.style.filter = isNormal ? 'none' : 'url(#note-wobble)';
  var countdownColor = isNormal ? 'rgba(232,150,66,0.9)' : 'rgba(150,150,155,0.9)';
  bubble.style.borderColor = countdownColor;
  numberEl.style.color = countdownColor;
  var counts = isNormal ? ['5', '4', '3', '2', '1', '0'] : ['3', '2', '1']; // 丸数字のUnicode文字はフォントによって欠けるため、プレーンな数字+CSSの円にする
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

  // ★ 読み込み(初回は時間がかかり、2回目以降はキャッシュされて一瞬で終わる)の速さに関わらず、
  //   カウントダウンが始まるタイミングを一定にするための基準時刻。
  //   ピアノ音源(soft/mid/loud×30音=90ファイル)はタイトルタップ時点で先読みを始めているため
  //   通常はここに来る頃には完了しているが、低速回線などの遅いケースも見積もって、
  //   余裕を持った時間に統一する(読み込みがこれより長引いた場合のみ、その時点ですぐ始める)。
  var openStartTime = performance.now();
  var MIN_DELAY_BEFORE_COUNTDOWN_MS = 800;

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
      currentSong.chart = chart;
      currentSong.gainCompensation = songEntry.gainCompensation || 1;
      currentSong.audioIndex = 0;
      currentSong.chartIndex = 0;
      currentSong.score = 0;
      currentSong.paused = false; // 前回の状態が万一残っていても、必ずリセットしてから始める
      currentSong.lastFishMilestone = 0;
      currentSong.entryId = songEntry.id;
      currentSong.entryMaxScore = songEntry.maxScore || 0;
      currentSong.accuracyHistory = [];
      var scoreEl = document.getElementById('studioScoreValue');
      if (scoreEl) scoreEl.textContent = '0';

      // ★ ここまでの読み込みが速く終わっても、再生ボタンを押してから
      //   MIN_DELAY_BEFORE_COUNTDOWN_MS経つまではカウントダウンを始めない(タイミングを一定にする)
      var elapsed = performance.now() - openStartTime;
      var remaining = Math.max(0, MIN_DELAY_BEFORE_COUNTDOWN_MS - elapsed);
      setTimeout(function () {
        if (document.getElementById('scene-studio-play').classList.contains('hidden')) return; // 待っている間に閉じられていたら何もしない
        runCountdown(function () {
          if (document.getElementById('scene-studio-play').classList.contains('hidden')) return; // 待っている間に閉じられていたら何もしない
          currentSong.startCtxTime = ctx.currentTime;
          currentSong.playing = true;
          startAudioScheduler();
          startChartScheduler();
        });
      }, remaining);
    });
  });
}

export function closeStudioPlay() {
  var savePromise = stopSongPlayback();
  document.getElementById('studio-countdown').style.display = 'none';
  document.getElementById('scene-studio-play').classList.add('hidden');
  document.getElementById('scene-home').classList.remove('hidden');
  document.getElementById('studio-list-overlay').style.display = 'flex';
  renderStudioSongList(); // 保存前の状態でも、ひとまず一覧を表示しておく(体感速度を優先)
  savePromise.then(function () {
    renderStudioSongList(); // 保存が完了したら、最新の状態(MAX SCORE等)で再描画し直す
  });
}

// 曲の詳細(MAX SCORE・直近10プレイのaccuracyグラフ)をモーダルで表示する
function openStudioDetail(entry) {
  document.getElementById('studio-detail-title').textContent = entry.name;
  document.getElementById('studio-detail-maxscore').textContent = entry.maxScore || 0;
  hideStudioPlayFloat(); // 開き直すたびに、前回タップした詳細表示はリセットする
  var overlay = document.getElementById('studio-detail-overlay');
  overlay.style.display = 'flex';
  requestAnimationFrame(function () {
    requestAnimationFrame(function () { overlay.style.opacity = '1'; });
  });
  var canvas = document.getElementById('studio-detail-canvas');
  var playHistory = entry.playHistory || [];
  var starPositions = [];
  requestAnimationFrame(function () {
    starPositions = drawSparkline(canvas, playHistory) || [];
  });

  // 星(実際にプレイした点)をタップすると、その回のスコア・正確さ・日時を
  // 枠線のない独立したフローティングウィンドウでふわっと表示する
  canvas.onclick = function (e) {
    var rect = canvas.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var y = e.clientY - rect.top;
    var HIT_RADIUS = 12; // 指でのタップは狙いにくいので、星の見た目より広めに判定する
    var nearest = null;
    var nearestDist = Infinity;
    starPositions.forEach(function (p) {
      var dist = Math.hypot(x - p.x, y - p.y);
      if (dist < nearestDist) { nearestDist = dist; nearest = p; }
    });
    if (!nearest || nearestDist > HIT_RADIUS) { hideStudioPlayFloat(); return; }

    var point = playHistory[nearest.index];
    var d = new Date(point.date);
    var dateStr = d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
      ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    showStudioPlayFloat(e.clientX, e.clientY, dateStr, point.score, point.accuracy);
  };
}

// グラフの星をタップした時の、枠線なしフローティングウィンドウを表示する(ふわっと浮かび上がる)
function showStudioPlayFloat(clientX, clientY, dateStr, score, accuracy) {
  var el = document.getElementById('studio-play-float');
  document.getElementById('studio-play-float-date').textContent = dateStr;
  document.getElementById('studio-play-float-score').textContent = score;
  document.getElementById('studio-play-float-accuracy').textContent = accuracy.toFixed(1);

  // タップした指の少し上に出す。画面端でははみ出さないよう位置を調整する
  el.style.display = 'block';
  el.style.opacity = '0';
  el.style.transform = 'translateY(6px) scale(0.96)';
  requestAnimationFrame(function () {
    var w = el.offsetWidth, h = el.offsetHeight;
    var left = Math.min(Math.max(8, clientX - w / 2), window.innerWidth - w - 8);
    var top = Math.max(8, clientY - h - 18);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    requestAnimationFrame(function () {
      el.style.opacity = '1';
      el.style.transform = 'translateY(0) scale(1)';
    });
  });
}

function hideStudioPlayFloat() {
  var el = document.getElementById('studio-play-float');
  if (!el) return;
  el.style.opacity = '0';
  el.style.transform = 'translateY(6px) scale(0.96)';
}

function closeStudioDetail() {
  var overlay = document.getElementById('studio-detail-overlay');
  overlay.style.opacity = '0';
  hideStudioPlayFloat();
  setTimeout(function () { overlay.style.display = 'none'; }, 350);
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
  var detailCloseBtn = document.getElementById('studio-detail-close');
  if (detailCloseBtn) {
    detailCloseBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      closeStudioDetail();
    });
  }
  // studio-closeボタンは廃止。closeStudioPlay()自体は他の経路から呼べるよう残す
}

// assets/audio-engine.js
// Salamander Grand Piano（soft/mid/loudの3レイヤー）を使った、
// 軽量なピアノ再生エンジン。88鍵ぶんのサンプルではなく、
// 30音だけをサンプリングし、それ以外の音程はピッチシフトで補う。
//
// PC版(core.js)の設計にならい、「未来のタイムスタンプでまとめて予約する」のではなく、
// 「その瞬間が来たら、今すぐ鳴らす／今すぐ止める」というリアルタイム駆動にしている。
// 音程ごとに1つだけアクティブな音を持ち、同じ音程が連打されたら前の音を止めてから
// 新しい音を鳴らす（PC版のactiveSources Mapと同じ考え方）。

var SAMPLE_NOTES = [
  {n:'A0',m:21},{n:'C1',m:24},{n:'Ds1',m:27},{n:'Fs1',m:30},{n:'A1',m:33},
  {n:'C2',m:36},{n:'Ds2',m:39},{n:'Fs2',m:42},{n:'A2',m:45},
  {n:'C3',m:48},{n:'Ds3',m:51},{n:'Fs3',m:54},{n:'A3',m:57},
  {n:'C4',m:60},{n:'Ds4',m:63},{n:'Fs4',m:66},{n:'A4',m:69},
  {n:'C5',m:72},{n:'Ds5',m:75},{n:'Fs5',m:78},{n:'A5',m:81},
  {n:'C6',m:84},{n:'Ds6',m:87},{n:'Fs6',m:90},{n:'A6',m:93},
  {n:'C7',m:96},{n:'Ds7',m:99},{n:'Fs7',m:102},{n:'A7',m:105},
  {n:'C8',m:108}
];

var pianoCtx = null;
var pianoBuffers = { soft: {}, mid: {}, loud: {} };
var pianoLoadingPromise = null;
var masterGain = null;
var activeSources = {}; // 音程(pitch)ごとに、今鳴っている音を1つだけ保持する(PC版のactiveSources Mapと同じ)

export function getPianoCtx() {
  if (!pianoCtx) {
    pianoCtx = new (window.AudioContext || window.webkitAudioContext)();
    // 複数の音が重なった時に音量を足し算しすぎて歪む(音割れする)のを防ぐリミッター
    var compressor = pianoCtx.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.knee.value = 20;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.15;
    masterGain = pianoCtx.createGain();
    masterGain.gain.value = 2.2; // 元の録音自体が控えめな音量だったため底上げする
    masterGain.connect(compressor).connect(pianoCtx.destination);
  }
  return pianoCtx;
}

export function loadPianoSamples() {
  if (pianoLoadingPromise) return pianoLoadingPromise;
  var ctx = getPianoCtx();
  var layers = ['soft', 'mid', 'loud'];
  var tasks = [];
  var successCount = 0;
  var failCount = 0;
  layers.forEach(function (layer) {
    SAMPLE_NOTES.forEach(function (sn) {
      var url = 'assets/' + layer + '/' + sn.n + '.opus';
      tasks.push(fetchSampleWithRetry(url, ctx, 2).then(function (decoded) {
        if (decoded) { pianoBuffers[layer][sn.n] = decoded; successCount++; }
        else { failCount++; }
      }));
    });
  });
  pianoLoadingPromise = Promise.all(tasks).then(function () {
    console.log('Piano samples loaded: ' + successCount + ' 成功 / ' + failCount + ' 失敗 (合計' + (successCount + failCount) + ')');
    if (failCount > 0) {
      console.error('音源の一部または全部が読み込めていません。Networkタブでopusファイルの状態(200/404/CORS等)を確認してください。');
    }
  });
  return pianoLoadingPromise;
}

// モバイル回線などでの一時的な通信エラー(ERR_CONNECTION_RESET等)に備えて、失敗時は数回リトライする
function fetchSampleWithRetry(url, ctx, retriesLeft) {
  return fetch(url)
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
      return r.arrayBuffer();
    })
    .then(function (buf) { return ctx.decodeAudioData(buf); })
    .catch(function (err) {
      if (retriesLeft > 0) {
        console.warn('retrying sample load:', url, err);
        return fetchSampleWithRetry(url, ctx, retriesLeft - 1);
      }
      console.error('sample load failed:', url, err);
      return null;
    });
}

function nearestSample(midiPitch) {
  var best = SAMPLE_NOTES[0];
  var bestDist = Math.abs(midiPitch - best.m);
  for (var i = 1; i < SAMPLE_NOTES.length; i++) {
    var d = Math.abs(midiPitch - SAMPLE_NOTES[i].m);
    if (d < bestDist) { best = SAMPLE_NOTES[i]; bestDist = d; }
  }
  return best;
}

// midiplayer.jsはvelocityを0-127ではなく0-100スケールで出力する仕様のため、それに合わせる
function velocityToLayer(v) {
  var v127 = Math.round(v / 100 * 127);
  if (v127 < 45) return 'soft';
  if (v127 < 95) return 'mid';
  return 'loud';
}

// 今すぐ、指定した音程を鳴らす(PC版のplayNoteに相当)。
// pitch: MIDIノート番号, velocity: 0-100スケール, durationMs: 目安の長さ(省略時は自然な余韻)
export function playNote(pitch, velocity, durationMs) {
  var ctx = getPianoCtx();
  var now = ctx.currentTime;

  // 同じ音程が既に鳴っていたら、まず素早く止める(連打時のノイズ対策。PC版と同じ)
  stopNote(pitch, 0.015);

  var layer = velocityToLayer(velocity);
  var sample = nearestSample(pitch);
  var buffer = pianoBuffers[layer][sample.n];
  if (!buffer) return;

  var semitoneDiff = pitch - sample.m;
  var playbackRate = Math.pow(2, semitoneDiff / 12);

  var src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = playbackRate;

  var gainNode = ctx.createGain();
  var v127 = Math.round(velocity / 100 * 127);
  var peakGain = Math.max(0.15, Math.min(1, v127 / 110));
  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(peakGain, now + 0.005); // ごく短いアタック

  src.connect(gainNode).connect(masterGain);
  src.start(now);

  activeSources[pitch] = { src: src, gainNode: gainNode, peakGain: peakGain };

  // 明示的なnote-offが来ない場合に備えて、長さの目安で自動的に止める
  var durSec = Math.max(0.05, (durationMs || 400) / 1000);
  var releaseSec = 0.2;
  gainNode.gain.setTargetAtTime(0.0001, now + durSec, releaseSec / 3);
  try { src.stop(now + durSec + releaseSec + 0.05); } catch (err) { /* 念のため */ }

  src.addEventListener('ended', function () {
    if (activeSources[pitch] && activeSources[pitch].src === src) delete activeSources[pitch];
  });
}

// 今すぐ、指定した音程を止める(PC版のstopNoteに相当)。
// fadeSec: 消えるまでの時間(短いほど鋭く切れる)
export function stopNote(pitch, fadeSec) {
  var entry = activeSources[pitch];
  if (!entry) return;
  var ctx = getPianoCtx();
  var now = ctx.currentTime;
  var fade = fadeSec != null ? fadeSec : 0.05;
  try {
    entry.gainNode.gain.cancelScheduledValues(now);
    entry.gainNode.gain.setValueAtTime(entry.gainNode.gain.value, now);
    entry.gainNode.gain.linearRampToValueAtTime(0, now + fade);
    entry.src.stop(now + fade + 0.02);
  } catch (err) { /* 既に停止済みの場合は無視 */ }
  delete activeSources[pitch];
}

// 再生中の音を、すべて即座に止める(「停止」ボタン用)
export function stopAllNotes() {
  Object.keys(activeSources).forEach(function (pitch) {
    try { activeSources[pitch].src.stop(); } catch (err) { /* 既に停止済みの場合は無視 */ }
  });
  activeSources = {};
}

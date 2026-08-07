// assets/audio-engine.js
// Salamander Grand Piano（soft/mid/loudの3レイヤー）を使った、
// 軽量なピアノ再生エンジン。88鍵ぶんのサンプルではなく、
// 30音だけをサンプリングし、それ以外の音程はピッチシフトで補う。

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
var activeSources = []; // 予約済み・再生中のAudioBufferSourceNodeを追跡し、停止できるようにする

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
    masterGain.gain.value = 2.2;
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

// note: {pitch, velocity, time, duration}, startAt: AudioContext上の絶対時刻(秒)
export function scheduleNote(note, startAt) {
  var ctx = getPianoCtx();
  var layer = velocityToLayer(note.velocity);
  var sample = nearestSample(note.pitch);
  var buffer = pianoBuffers[layer][sample.n];
  if (!buffer) return;

  var semitoneDiff = note.pitch - sample.m;
  var playbackRate = Math.pow(2, semitoneDiff / 12);

  var src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = playbackRate;

  var gainNode = ctx.createGain();
  var v127 = Math.round(note.velocity / 100 * 127);
  gainNode.gain.value = Math.max(0.15, Math.min(1, v127 / 110));

  src.connect(gainNode).connect(masterGain);
  src.start(startAt);

  activeSources.push(src);
  src.addEventListener('ended', function () {
    var idx = activeSources.indexOf(src);
    if (idx !== -1) activeSources.splice(idx, 1);
  });
}

// 再生中・予約済みの音を、すべて即座に止める(「停止」ボタン用)
export function stopAllNotes() {
  activeSources.forEach(function (src) {
    try { src.stop(); } catch (err) { /* 既に停止済みの場合は無視 */ }
  });
  activeSources = [];
}

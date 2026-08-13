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

// 新しい音声ファイルを一切追加せず、その場でノイズを指数関数的に減衰させて
// 擬似的なインパルスレスポンス(IR)を生成する、コード生成リバーブの定番手法。
// durationSec: 響きの長さ、decay: 減衰カーブの鋭さ(大きいほど早く減衰する)
function createReverbImpulse(ctx, durationSec, decay) {
  var sampleRate = ctx.sampleRate;
  var length = Math.floor(sampleRate * durationSec);
  var impulse = ctx.createBuffer(2, length, sampleRate);
  for (var ch = 0; ch < 2; ch++) {
    var data = impulse.getChannelData(ch);
    for (var i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

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
    masterGain.gain.value = 1.1; // 端末側の音量を無理に下げずに済むよう、控えめな音量にしておく
    masterGain.connect(compressor).connect(pianoCtx.destination);

    // ---- リバーブ(センド/リターン方式)：サンプルをそのまま鳴らすだけの単調さを、
    //      奥行きのある響きに変える。ファイルを追加しないぶん容量・読み込み時間は増えない ----
    try {
      var convolver = pianoCtx.createConvolver();
      // IRを短くして、ConvolverNodeの初期化(内部でのFFT前処理)にかかる負荷を減らす。
      // 長いIRほど「ぶつっ」というノイズの原因になりやすいため、響きの長さと引き換えに短縮する
      convolver.buffer = createReverbImpulse(pianoCtx, 1.3, 2.8);
      convolver.normalize = true;
      var reverbSend = pianoCtx.createGain();
      reverbSend.gain.value = 0.32; // masterGainのうち、どれだけをリバーブに送るか
      var reverbWet = pianoCtx.createGain();
      reverbWet.gain.value = 0.85; // リバーブ自体の最終的な音量
      masterGain.connect(reverbSend).connect(convolver).connect(reverbWet).connect(compressor);

      // ConvolverNodeは、実際に信号が流れ込む(=最初の1音を弾く)瞬間に重い初期化処理が
      // 走りやすく、それが「ぶつっ」というノイズの原因になる。ごく短い無音をあらかじめ
      // リバーブ経路に流しておくことで、実際の1音目より前に初期化を終わらせておく
      var reverbPrimerBuffer = pianoCtx.createBuffer(1, 1, pianoCtx.sampleRate);
      var reverbPrimerSrc = pianoCtx.createBufferSource();
      reverbPrimerSrc.buffer = reverbPrimerBuffer;
      reverbPrimerSrc.connect(reverbSend);
      reverbPrimerSrc.start(0);
    } catch (err) { /* ConvolverNode非対応の環境でも、リバーブなしで通常通り鳴らせるようにする */ }

    // AudioContextを作った直後、一番最初に鳴らす音が「ぶつっ」と鳴ることがある
    // (音声パイプラインがまだ準備できていないことによるノイズ)。ごく短い無音を
    // 一度鳴らしておくことで、パイプラインを暖機し、実際の1音目でのノイズを防ぐ
    try {
      var primerBuffer = pianoCtx.createBuffer(1, 1, pianoCtx.sampleRate);
      var primerSrc = pianoCtx.createBufferSource();
      primerSrc.buffer = primerBuffer;
      primerSrc.connect(pianoCtx.destination);
      primerSrc.start(0);
    } catch (err) { /* 暖機に失敗しても致命的ではないので無視する */ }
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
  // PC版のplayNoteと同じ、念のための防御的な確認。一時停止明けなどでサスペンド状態が
  // 残っていると、無音のまま鳴らなくなることがあるため、毎回ここで起こしておく
  if (ctx.state === 'suspended') { ctx.resume(); }
  var now = ctx.currentTime;

  // 同じ音程が既に鳴っていたら、まず素早く止める(連打時のノイズ対策。PC版と同じ)
  stopNote(pitch, 0.03);

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

  // ---- 疑似ステレオ：実際のグランドピアノと同じく、低音は左寄り・高音は右寄りに
  //      わずかに振り分ける。新しい音声ファイルは追加しないので容量は変わらない ----
  var panNode = null;
  if (typeof ctx.createStereoPanner === 'function') {
    panNode = ctx.createStereoPanner();
    var PAN_LOW_MIDI = 21;  // 88鍵の一番低い音(A0)
    var PAN_HIGH_MIDI = 108; // 88鍵の一番高い音(C8)
    var panNorm = (pitch - PAN_LOW_MIDI) / (PAN_HIGH_MIDI - PAN_LOW_MIDI); // 0(低音)〜1(高音)
    panNode.pan.value = Math.max(-1, Math.min(1, (panNorm - 0.5) * 0.7)); // 振り幅は控えめに(-0.35〜0.35)
  }

  if (panNode) {
    src.connect(gainNode).connect(panNode).connect(masterGain);
  } else {
    src.connect(gainNode).connect(masterGain); // StereoPannerNode非対応環境では、これまで通りモノラルで鳴らす
  }
  src.start(now);

  activeSources[pitch] = { src: src, gainNode: gainNode, peakGain: peakGain };

  // 明示的なnote-offが来ない場合に備えて、長さの目安で自動的に止める
  var durSec = Math.max(0.05, (durationMs || 400) / 1000);
  // 余韻を長めに取る。低音ほど波形の周期が長く、短い減衰だと波の途中で
  // 打ち切られてクリックノイズ(「じじ」)が出やすいため、低音ほどさらに長くする
  var releaseSec = 0.5 + Math.max(0, 60 - pitch) * 0.012; // 低音ほど+最大で0.7秒ほど長くなる
  gainNode.gain.setTargetAtTime(0.0001, now + durSec, releaseSec / 3);
  // setTargetAtTimeは指数関数的に減衰するため、releaseSecちょうどでは完全に0にならない。
  // 波形の途中でバッファを打ち切るとクリックノイズの原因になるため、
  // 十分に減衰しきるまで(時定数の7倍程度)余裕を持ってから止める
  try { src.stop(now + durSec + releaseSec * 2.4); } catch (err) { /* 念のため */ }

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

// 再生中の音を、すべてすぐに止める(「停止」ボタン用)。
// 波形の途中でいきなり切ると「じじ」というクリックノイズが出るため、ごく短いフェードは必ず挟む
export function stopAllNotes() {
  Object.keys(activeSources).forEach(function (pitch) {
    stopNote(Number(pitch), 0.02);
  });
  activeSources = {};
}

// assets/audio-engine.js
// Salamander Grand Piano を使った、軽量なピアノ再生エンジン。
// 「通常音質」は3レイヤー(soft/mid/loud)×30音のみをサンプリングし、それ以外の音程はピッチシフトで補う。
// 「高音質」は将来、より多いベロシティ段階・より密なサンプリングのファイル一式を追加した時のための
// 受け皿(まだ実ファイルは無い。QUALITY_CONFIGS.highのnotes/layersを実際のファイル構成に合わせて
// 書き換え、対応するファイルをbasePath配下に置くだけで動く設計にしてある)。
//
// PC版(core.js)の設計にならい、「未来のタイムスタンプでまとめて予約する」のではなく、
// 「その瞬間が来たら、今すぐ鳴らす／今すぐ止める」というリアルタイム駆動にしている。
// 音程ごとに1つだけアクティブな音を持ち、同じ音程が連打されたら前の音を止めてから
// 新しい音を鳴らす（PC版のactiveSources Mapと同じ考え方）。

var NORMAL_SAMPLE_NOTES = [
  {n:'A0',m:21},{n:'C1',m:24},{n:'Ds1',m:27},{n:'Fs1',m:30},{n:'A1',m:33},
  {n:'C2',m:36},{n:'Ds2',m:39},{n:'Fs2',m:42},{n:'A2',m:45},
  {n:'C3',m:48},{n:'Ds3',m:51},{n:'Fs3',m:54},{n:'A3',m:57},
  {n:'C4',m:60},{n:'Ds4',m:63},{n:'Fs4',m:66},{n:'A4',m:69},
  {n:'C5',m:72},{n:'Ds5',m:75},{n:'Fs5',m:78},{n:'A5',m:81},
  {n:'C6',m:84},{n:'Ds6',m:87},{n:'Fs6',m:90},{n:'A6',m:93},
  {n:'C7',m:96},{n:'Ds7',m:99},{n:'Fs7',m:102},{n:'A7',m:105},
  {n:'C8',m:108}
];

// ---- 音質プリセット ----
// 各プリセットは「どのフォルダから」「どんな強弱レイヤー名で」「どの音程のサンプルを」読むかを持つ。
// layerBoundaries は、velocity(0-127)をどのレイヤーに振り分けるかの閾値。
// 配列の要素数はlayers配列より1つ少ない(例：layers 3つなら閾値2つ)。
var QUALITY_CONFIGS = {
  normal: {
    label: '通常',
    basePath: 'assets/',
    layers: ['soft', 'mid', 'loud'],
    layerBoundaries: [45, 95],
    notes: NORMAL_SAMPLE_NOTES
  },
  // ★ 高音質プリセット：まだ実ファイルが存在しないプレースホルダ。
  //   実際のファイルを用意する時は、basePath配下に layers×notes ぶんの
  //   「<layer>/<note.n>.opus」ファイルを配置し、必要ならlayers/layerBoundaries/notesを
  //   実際のファイル構成(ベロシティ段階数・サンプリング間隔)に合わせて書き換えるだけでよい。
  high: {
    label: '高音質',
    basePath: 'assets/hq/',
    layers: ['soft', 'mid', 'loud'], // TODO: 実ファイル用意時、より多いレイヤー数に差し替え可能
    layerBoundaries: [45, 95],
    notes: NORMAL_SAMPLE_NOTES, // TODO: 実ファイル用意時、より密なサンプリング音程リストに差し替え可能
    estimatedSizeMB: 45 // TODO: 実ファイル用意時、実際の合計サイズ(MB)に書き換える(起動時ダイアログの時間見積りに使う)
  }
};

// 現在の回線速度から、指定した音質のダウンロードにかかる予想時間を見積もる。
// Network Information API(navigator.connection)が使える環境ではそこから実測に近い値を、
// 使えない環境ではモバイル回線を想定した控えめな値で見積もる
export function estimateQualityDownload(quality) {
  var config = QUALITY_CONFIGS[quality];
  var sizeMB = (config && config.estimatedSizeMB) || 0;
  var downlinkMbps = 4; // 取得できない場合のフォールバック値(控えめな4G回線を想定)
  try {
    var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn && conn.downlink) downlinkMbps = conn.downlink;
  } catch (err) { /* Network Information API非対応の環境では無視してフォールバック値を使う */ }
  var sizeMbit = sizeMB * 8; // MB -> Mbit
  var estimatedSeconds = Math.ceil(sizeMbit / Math.max(0.5, downlinkMbps));
  return { sizeMB: sizeMB, estimatedSeconds: estimatedSeconds };
}

var AUDIO_QUALITY_STORAGE_KEY = 'pianoworks_audio_quality';
var currentQuality = 'normal'; // getAudioQuality()定義後、下で保存済みの設定に合わせて初期化し直す
var pianoCtx = null;
var pianoBuffers = { soft: {}, mid: {}, loud: {} }; // 現在読み込み済み・アクティブな音質のバッファ
var pianoLoadingPromise = null; // 現在ロード中/ロード済みの音質に対応するPromise
var loadedQualityOfPromise = null; // pianoLoadingPromiseがどの音質を指しているか
var masterGain = null;
var activeSources = {}; // 音程(pitch)ごとに、今鳴っている音を1つだけ保持する(PC版のactiveSources Mapと同じ)

// 今どの音質が選ばれているか(保存された設定 > デフォルト'normal')を返す
export function getAudioQuality() {
  try {
    var saved = localStorage.getItem(AUDIO_QUALITY_STORAGE_KEY);
    if (saved === 'high' || saved === 'normal') return saved;
  } catch (err) { /* localStorage不可の環境では無視してデフォルトを使う */ }
  return 'normal';
}

function saveAudioQuality(quality) {
  try { localStorage.setItem(AUDIO_QUALITY_STORAGE_KEY, quality); } catch (err) { /* 無視 */ }
}

// モジュール読み込み時点で、保存済みの設定を初期値として反映しておく
// (これにより、無引数のloadPianoSamples()が最初から正しい音質を読みにいく)
currentQuality = getAudioQuality();

// 設定画面のトグルなどから呼ぶ。指定した音質の音源を読み込み(まだなら)、
// 読み込めたらそちらに切り替える。失敗したら'normal'に自動で戻し、rejectする。
export function setAudioQuality(quality) {
  if (quality !== 'normal' && quality !== 'high') return Promise.reject(new Error('unknown quality: ' + quality));
  return loadPianoSamples(quality).then(function (result) {
    if (!result.ok) {
      // 高音質ファイルが用意されていない/読み込みに失敗した場合は、通常音質に自動で戻す
      currentQuality = 'normal';
      saveAudioQuality('normal');
      return Promise.reject(new Error('failed to load "' + quality + '" quality samples (fell back to normal)'));
    }
    currentQuality = quality;
    saveAudioQuality(quality);
    return quality;
  });
}



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

// quality省略時は、現在アクティブな音質(なければ保存済み設定 > 'normal')を読み込む。
// 戻り値は { ok, successCount, failCount } を解決するPromise。
export function loadPianoSamples(quality) {
  var targetQuality = quality || currentQuality || getAudioQuality();
  // 既にこの音質を読み込み中/読み込み済みなら、そのPromiseを使い回す
  if (pianoLoadingPromise && loadedQualityOfPromise === targetQuality) return pianoLoadingPromise;

  var ctx = getPianoCtx();
  var config = QUALITY_CONFIGS[targetQuality];
  var buffers = {};
  config.layers.forEach(function (layer) { buffers[layer] = {}; });

  var tasks = [];
  var successCount = 0;
  var failCount = 0;
  config.layers.forEach(function (layer) {
    config.notes.forEach(function (sn) {
      var url = config.basePath + layer + '/' + sn.n + '.opus';
      tasks.push(fetchSampleWithRetry(url, ctx, targetQuality === 'normal' ? 2 : 0).then(function (decoded) {
        if (decoded) { buffers[layer][sn.n] = decoded; successCount++; }
        else { failCount++; }
      }));
    });
  });

  var promise = Promise.all(tasks).then(function () {
    var total = successCount + failCount;
    console.log('Piano samples loaded [' + targetQuality + ']: ' + successCount + ' 成功 / ' + failCount + ' 失敗 (合計' + total + ')');
    // 1つも読み込めなかった場合のみ失敗扱いにする(ファイルがまだ用意されていないケースを想定)。
    // 一部だけ失敗の場合は、通常運用(モバイル回線の一時エラー等)なので読み込めた分で続行する
    var ok = successCount > 0;
    if (ok) {
      pianoBuffers = buffers;
      currentQuality = targetQuality;
      return { ok: true, successCount: successCount, failCount: failCount };
    }
    console.error('"' + targetQuality + '"音質のサンプルが1つも読み込めませんでした。ファイルが未配置か、パスが違う可能性があります: ' + config.basePath);
    if (targetQuality !== 'normal') {
      // 保存されていた設定が「高音質」でも、ファイル未配置等で読み込めなかった場合は
      // 無音のまま起動してしまわないよう、通常音質に自動で切り替えて設定も戻しておく
      console.warn('"' + targetQuality + '"が読み込めなかったため、"normal"に自動フォールバックします。');
      saveAudioQuality('normal');
      pianoLoadingPromise = null; // normalを読み直せるようキャッシュをクリアする
      return loadPianoSamples('normal');
    }
    return { ok: false, successCount: successCount, failCount: failCount };
  });

  pianoLoadingPromise = promise;
  loadedQualityOfPromise = targetQuality;
  return promise;
}

// モバイル回線などでの一時的な通信エラー(ERR_CONNECTION_RESET等)に備えて、失敗時は数回リトライする。
// (まだ存在しないプレースホルダ音質を試す時は、無駄な404リトライを避けるため retries=0 で呼ばれる)
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
      return null;
    });
}

function nearestSample(midiPitch) {
  var notes = QUALITY_CONFIGS[currentQuality].notes;
  var best = notes[0];
  var bestDist = Math.abs(midiPitch - best.m);
  for (var i = 1; i < notes.length; i++) {
    var d = Math.abs(midiPitch - notes[i].m);
    if (d < bestDist) { best = notes[i]; bestDist = d; }
  }
  return best;
}

// midiplayer.jsはvelocityを0-127ではなく0-100スケールで出力する仕様のため、それに合わせる。
// 現在アクティブな音質設定のlayers/layerBoundariesを見て、何段階のレイヤーでも対応できる汎用実装
function velocityToLayer(v) {
  var v127 = Math.round(v / 100 * 127);
  var config = QUALITY_CONFIGS[currentQuality];
  var layers = config.layers;
  var boundaries = config.layerBoundaries;
  for (var i = 0; i < boundaries.length; i++) {
    if (v127 < boundaries[i]) return layers[i];
  }
  return layers[layers.length - 1];
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
  // ---- ベロシティに応じたアタック時間：実際のピアノは強く弾くほどハンマーが速く弦を叩くため
  //      アタックが鋭くなり、弱く弾くほど少しゆったり立ち上がる。これまでは常に5ms固定だった ----
  var attackSec = 0.003 + (1 - v127 / 127) * 0.02; // 強打で約3ms、最弱打で約23ms
  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(peakGain, now + attackSec);

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
  // ベロシティによる補正：強く弾くほど弦に伝わるエネルギーが大きく、余韻がわずかに長く残る
  // (逆に弱打は早めに減衰する)。0.85倍(最弱打)〜1.15倍(最強打)程度の控えめな幅で揺らす
  releaseSec *= 0.85 + (v127 / 127) * 0.3;
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

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

export function getPianoCtx() {
  pianoCtx = pianoCtx || new (window.AudioContext || window.webkitAudioContext)();
  return pianoCtx;
}

export function loadPianoSamples() {
  if (pianoLoadingPromise) return pianoLoadingPromise;
  var ctx = getPianoCtx();
  var layers = ['soft', 'mid', 'loud'];
  var tasks = [];
  layers.forEach(function (layer) {
    SAMPLE_NOTES.forEach(function (sn) {
      var url = 'assets/sounds/' + layer + '/' + sn.n + '.opus';
      tasks.push(
        fetch(url)
          .then(function (r) { return r.arrayBuffer(); })
          .then(function (buf) { return ctx.decodeAudioData(buf); })
          .then(function (decoded) { pianoBuffers[layer][sn.n] = decoded; })
          .catch(function (err) { console.error('sample load failed:', url, err); })
      );
    });
  });
  pianoLoadingPromise = Promise.all(tasks).then(function () {
    console.log('Piano samples loaded');
  });
  return pianoLoadingPromise;
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

function velocityToLayer(v) {
  var v127 = v <= 1 ? v * 127 : v;
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
  var v127 = note.velocity <= 1 ? note.velocity * 127 : note.velocity;
  gainNode.gain.value = Math.max(0.15, Math.min(1, v127 / 110));

  src.connect(gainNode).connect(ctx.destination);
  src.start(startAt);
}

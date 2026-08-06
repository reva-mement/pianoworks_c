// assets/midi-import.js
// 本体(main.js)のextractNotesFromMidiを移植したもの。
// MidiPlayerのパース結果(player)から、音符データの配列(songData)を作る。

export function extractNotesFromMidi(player) {
  var division = player.division;
  var allEvents = [];
  (player.tracks || []).forEach(function (track) {
    if (track && Array.isArray(track.events)) {
      allEvents.push.apply(allEvents, track.events);
    }
  });

  var tempoEvents = allEvents
    .filter(function (ev) { return ev.name === 'Set Tempo' && typeof ev.tick === 'number' && ev.data; })
    .map(function (ev) { return { tick: ev.tick, bpm: ev.data }; })
    .sort(function (a, b) { return a.tick - b.tick; });

  if (tempoEvents.length === 0 || tempoEvents[0].tick > 0) {
    tempoEvents.unshift({ tick: 0, bpm: player.tempo || 120 });
  }

  var segments = [];
  tempoEvents.forEach(function (te) {
    var msPerTick = (60 / te.bpm / division) * 1000;
    var prev = segments[segments.length - 1];
    var startMs = prev ? prev.startMs + (te.tick - prev.startTick) * prev.msPerTick : 0;
    segments.push({ startTick: te.tick, startMs: startMs, msPerTick: msPerTick });
  });

  function tickToMs(targetTick) {
    for (var i = segments.length - 1; i >= 0; i--) {
      if (segments[i].startTick <= targetTick) {
        var seg = segments[i];
        return seg.startMs + (targetTick - seg.startTick) * seg.msPerTick;
      }
    }
    return 0;
  }

  var songData = [];
  var lastEndMs = 0;

  (player.tracks || []).forEach(function (track) {
    if (!track || !Array.isArray(track.events)) return;
    var activeNotes = {};

    track.events.forEach(function (ev) {
      if (ev.name === "Note on" && ev.velocity > 0) {
        activeNotes[ev.noteNumber] = { startTick: ev.tick, velocity: ev.velocity };
      }
      if (ev.name === "Note off" || (ev.name === "Note on" && ev.velocity === 0)) {
        var info = activeNotes[ev.noteNumber];
        if (info) {
          var startMs = tickToMs(info.startTick);
          var endMs = tickToMs(ev.tick);
          songData.push({
            pitch: ev.noteNumber,
            velocity: info.velocity,
            time: startMs,
            duration: Math.max(0, endMs - startMs)
          });
          if (endMs > lastEndMs) lastEndMs = endMs;
          delete activeNotes[ev.noteNumber];
        }
      }
    });
  });

  songData.sort(function (a, b) { return a.time - b.time; });

  return {
    notes: songData,
    durationMs: songData.length > 0 ? lastEndMs : 0
  };
}

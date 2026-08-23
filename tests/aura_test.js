// Unit tests for Aura.js. Run: node tests/aura_test.js
//
// Evaluated rather than imported: it is a QML .js module. Do not inline a
// copy -- an earlier version did and silently drifted out of date.
const fs = require('fs')
const path = require('path')
eval(fs.readFileSync(path.join(__dirname, '..', 'Aura.js'), 'utf8')
       .replace('.pragma library', ''))

let fail = 0
function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  const ok = g === w
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  got=${g}${ok ? '' : ' want=' + w}`)
}

eq('hexToRgb #ff00ff', hexToRgb('#ff00ff'), [255,0,255])
eq('hexToRgb no hash', hexToRgb('00ff00'), [0,255,0])
eq('hexToRgb junk -> null', hexToRgb('nope'), null)
eq('rgbToHex roundtrip', rgbToHex([255,0,255]), '#ff00ff')
eq('rgbToHex pads', rgbToHex([0,1,2]), '#000102')
eq('mix t=0', mix([0,0,0],[255,255,255],0), [0,0,0])
eq('mix t=1', mix([0,0,0],[255,255,255],1), [255,255,255])
eq('mix clamps t>1', mix([0,0,0],[10,10,10],5), [10,10,10])
eq('supportedModes G513', supportedModes([0,1,2,3,10]).map(m=>m.name),
   ['Static','Breathe','Rainbow cycle','Rainbow wave','Comet'])
eq('modeName 10', modeName(10), 'Comet')
eq('parseDevicePath', parseDevicePath('  |_ /xyz/ljones/aura/19b6_2_3\n'), '/xyz/ljones/aura/19b6_2_3')

// argv must never be shell-interpretable
const cmd = setModeDataCommand('/p', {mode:1, zone:0, colour1:[255,0,255], colour2:[0,0,0], speed:'Med', direction:'Right'})
eq('setModeData argv length', cmd.length, 18)
eq('setModeData signature', cmd[7], '(uu(yyy)(yyy)ss)')
eq('setModeData clamps colour', setModeDataCommand('/p',{mode:0,colour1:[999,-5,20]})[10], '255')
eq('setModeData rejects bad speed', setModeDataCommand('/p',{mode:0,speed:'Turbo'})[16], 'Med')
eq('setBrightness clamps', setBrightnessCommand('/p', 99)[8], '3')

// Against a real busctl payload
const real = '{"type":"a{sv}","data":[{"Brightness":{"type":"u","data":2},"LedModeData":{"type":"(uu(yyy)(yyy)ss)","data":[0,0,[255,0,255],[0,0,0],"Med","Right"]},"SupportedBasicModes":{"type":"au","data":[0,1,2,3,10]}}]}'
const props = parseGetAll(real)
eq('parseGetAll Brightness', props.Brightness, 2)
eq('parseGetAll LedModeData', props.LedModeData, [0,0,[255,0,255],[0,0,0],'Med','Right'])

// 400 peaks captured from PwNodePeakMonitor during playback: narrow, high,
// with gaps at zero. Every past failure of music mode showed up as this
// input producing a static output.
const REAL_PEAKS = [0.000,0.000,0.763,0.778,0.746,0.780,0.787,0.802,0.748,0.725,0.766,0.755,0.750,0.770,0.749,0.781,0.770,0.705,0.662,0.683,0.711,0.704,0.666,0.671,0.627,0.621,0.582,0.583,0.614,0.664,0.634,0.685,0.748,0.765,0.825,0.775,0.717,0.757,0.731,0.778,0.770,0.773,0.777,0.754,0.741,0.764,0.795,0.796,0.741,0.783,0.761,0.702,0.703,0.723,0.700,0.711,0.688,0.657,0.687,0.607,0.000,0.000,0.763,0.778,0.746,0.780,0.787,0.802,0.748,0.725,0.766,0.755,0.750,0.770,0.749,0.781,0.770,0.705,0.662,0.683,0.711,0.704,0.666,0.671,0.627,0.621,0.582,0.583,0.614,0.664,0.634,0.685,0.748,0.765,0.825,0.775,0.717,0.757,0.731,0.778,0.770,0.773,0.777,0.754,0.741,0.764,0.795,0.796,0.741,0.783,0.761,0.702,0.703,0.723,0.700,0.711,0.688,0.657,0.687,0.607,0.641,0.643,0.699,0.722,0.668,0.748,0.697,0.698,0.687,0.715,0.661,0.726,0.720,0.699,0.681,0.689,0.663,0.657,0.645,0.662,0.626,0.615,0.610,0.612,0.590,0.582,0.626,0.623,0.632,0.691,0.611,0.583,0.588,0.601,0.620,0.623,0.638,0.654,0.679,0.665,0.656,0.640,0.604,0.602,0.634,0.652,0.639,0.614,0.605,0.606,0.613,0.608,0.623,0.600,0.588,0.609,0.584,0.573,0.583,0.611,0.641,0.643,0.699,0.722,0.668,0.748,0.697,0.698,0.687,0.715,0.661,0.726,0.720,0.699,0.681,0.689,0.663,0.657,0.645,0.662,0.626,0.615,0.610,0.612,0.590,0.582,0.626,0.623,0.632,0.691,0.611,0.583,0.588,0.601,0.620,0.623,0.638,0.654,0.679,0.665,0.656,0.640,0.604,0.602,0.634,0.652,0.639,0.614,0.605,0.606,0.613,0.608,0.623,0.600,0.588,0.609,0.584,0.573,0.583,0.611,0.589,0.571,0.596,0.629,0.620,0.594,0.609,0.615,0.591,0.553,0.589,0.594,0.616,0.617,0.592,0.585,0.582,0.572,0.561,0.549,0.554,0.534,0.560,0.533,0.526,0.553,0.551,0.498,0.483,0.496,0.487,0.512,0.517,0.529,0.488,0.493,0.500,0.522,0.534,0.531,0.519,0.516,0.509,0.534,0.549,0.534,0.521,0.520,0.518,0.515,0.523,0.528,0.533,0.525,0.534,0.523,0.526,0.500,0.485,0.477,0.589,0.571,0.596,0.629,0.620,0.594,0.609,0.615,0.591,0.553,0.589,0.594,0.616,0.617,0.592,0.585,0.582,0.572,0.561,0.549,0.554,0.534,0.560,0.533,0.526,0.553,0.551,0.498,0.483,0.496,0.487,0.512,0.517,0.529,0.488,0.493,0.500,0.522,0.534,0.531,0.519,0.516,0.509,0.534,0.549,0.534,0.521,0.520,0.518,0.515,0.523,0.528,0.533,0.525,0.534,0.523,0.526,0.500,0.485,0.477,0.479,0.479,0.488,0.488,0.466,0.466,0.488,0.488,0.489,0.489,0.494,0.494,0.504,0.504,0.504,0.504,0.510,0.510,0.507,0.507,0.508,0.508,0.496,0.496,0.482,0.482,0.473,0.473,0.481,0.481,0.515,0.515,0.519,0.519,0.533,0.533,0.517,0.517,0.508,0.508]

eq('silence gate catches zero', isSilent(0), true)
eq('silence gate passes music', isSilent(0.5), false)

eq('release shortest at 1', Math.round(releaseMsFor(1)), 60)
eq('release longest at 10', Math.round(releaseMsFor(10)), 600)
eq('release monotonic', releaseMsFor(3) < releaseMsFor(8), true)
eq('attack shorter than any release', ATTACK_MS < releaseMsFor(1), true)

eq('window bounds bracket the signal', (() => {
  let c = 0.5, f = 0.5
  for (const p of REAL_PEAKS) {
    if (isSilent(p)) continue
    c = trackCeiling(c, p, 40); f = trackFloor(f, p, 40)
  }
  return f < c
})(), true)

// The ceiling holds near recent peaks instead of chasing the signal down;
// without that the window collapses onto the current sample.
eq('ceiling holds after a peak', (() => {
  let c = trackCeiling(0.2, 0.9, 40)
  const afterPeak = c
  c = trackCeiling(c, 0.1, 40)
  return c > afterPeak * 0.9
})(), true)

// The window's whole point: the ceiling chases peaks up and lets them go
// slowly, the floor does the reverse. Invert either and it stops tracking.
eq('ceiling rises faster than it falls', CEILING_RISE_MS < CEILING_FALL_MS, true)
eq('floor falls faster than it rises', FLOOR_FALL_MS < FLOOR_RISE_MS, true)

eq('normalise clamps', normaliseLevel(9, 0, 1) <= 1 && normaliseLevel(-9, 0, 1) >= 0, true)
eq('min window stops noise blowing up', Number.isFinite(normaliseLevel(0.5, 0.5, 0.5)), true)

// Full pipeline over the real capture.
function simulate(smoothing) {
  const iv = 40
  const aA = envelopeAlpha(ATTACK_MS, iv)
  const aR = envelopeAlpha(releaseMsFor(smoothing), iv)
  let c = null, f = null, lvl = 0
  const out = []
  for (const p of REAL_PEAKS) {
    let target
    if (isSilent(p)) {
      target = 0
    } else {
      if (c === null) { c = p; f = p }
      c = trackCeiling(c, p, iv); f = trackFloor(f, p, iv)
      target = normaliseLevel(p, f, c)
    }
    lvl += (target - lvl) * (target > lvl ? aA : aR)
    out.push(lvl)
  }
  return out.slice(Math.floor(out.length * 0.3))
}
function spread(o) {
  const mean = o.reduce((a, b) => a + b, 0) / o.length
  return {
    span: Math.max(...o) - Math.min(...o),
    mean: mean,
    sd: Math.sqrt(o.reduce((a, b) => a + (b - mean) ** 2, 0) / o.length),
    pinned: o.filter(x => x > 0.99).length / o.length
  }
}
const mid = spread(simulate(3))
eq('real signal drives a wide swing', mid.span > 0.7, true)
eq('output is not parked at the top', mid.mean < 0.85, true)
eq('output is not mostly clipped', mid.pinned < 0.25, true)
eq('output actually varies', mid.sd > 0.12, true)

function jerk(o) {
  let j = 0
  for (let i = 1; i < o.length; i++) j += Math.abs(o[i] - o[i - 1])
  return j / (o.length - 1)
}
eq('more smoothing means less frame-to-frame jump', jerk(simulate(10)) < jerk(simulate(1)), true)

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
process.exit(fail ? 1 : 0)

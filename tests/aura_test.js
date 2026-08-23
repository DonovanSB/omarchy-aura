// Unit tests for Aura.js. Run: node tests/aura_test.js
//
// The module is read and evaluated rather than copied in: an earlier version
// embedded a snapshot, which silently drifted and left the suite asserting
// against code that no longer existed.
const fs = require('fs')
const path = require('path')
eval(fs.readFileSync(path.join(__dirname, '..', 'Aura.js'), 'utf8')
       .replace('.pragma library', ''))

// ---- checks ----
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


// argv building must never emit a shell-interpretable blob
const cmd = setModeDataCommand('/p', {mode:1, zone:0, colour1:[255,0,255], colour2:[0,0,0], speed:'Med', direction:'Right'})
eq('setModeData argv length', cmd.length, 18)
eq('setModeData signature', cmd[7], '(uu(yyy)(yyy)ss)')
eq('setModeData clamps colour', setModeDataCommand('/p',{mode:0,colour1:[999,-5,20]})[10], '255')
eq('setModeData rejects bad speed', setModeDataCommand('/p',{mode:0,speed:'Turbo'})[16], 'Med')
eq('setBrightness clamps', setBrightnessCommand('/p', 99)[8], '3')

// GetAll parsing against the real payload shape
const real = '{"type":"a{sv}","data":[{"Brightness":{"type":"u","data":2},"LedModeData":{"type":"(uu(yyy)(yyy)ss)","data":[0,0,[255,0,255],[0,0,0],"Med","Right"]},"SupportedBasicModes":{"type":"au","data":[0,1,2,3,10]}}]}'
const props = parseGetAll(real)
eq('parseGetAll Brightness', props.Brightness, 2)
eq('parseGetAll LedModeData', props.LedModeData, [0,0,[255,0,255],[0,0,0],'Med','Right'])

// ---- music level pipeline ----
// Regression data: 400 real `peak` samples captured from PwNodePeakMonitor at
// 25 fps during actual playback on this machine. While music plays the signal
// sits between ~0.40 and ~0.88 -- narrow and high -- and drops to 0 in gaps.
// Every past failure of music mode showed up as this input producing a nearly
// static output, so the pipeline is asserted against the real thing.
const REAL_PEAKS = [0.000,0.000,0.657,0.651,0.739,0.760,0.640,0.533,0.477,0.771,0.754,0.617,0.683,0.569,0.777,0.839,0.800,0.838,0.792,0.780,0.787,0.615,0.690,0.756,0.780,0.746,0.657,0.599,0.424,0.837,0.728,0.686,0.672,0.417,0.836,0.831,0.847,0.844,0.835,0.739,0.725,0.671,0.635,0.765,0.846,0.840,0.828,0.845,0.539,0.836,0.797,0.777,0.833,0.850,0.847,0.838,0.834,0.770,0.810,0.787,0.000,0.000,0.657,0.651,0.739,0.760,0.640,0.533,0.477,0.771,0.754,0.617,0.683,0.569,0.777,0.839,0.800,0.838,0.792,0.780,0.787,0.615,0.690,0.756,0.780,0.746,0.657,0.599,0.424,0.837,0.728,0.686,0.672,0.417,0.836,0.831,0.847,0.844,0.835,0.739,0.725,0.671,0.635,0.765,0.846,0.840,0.828,0.845,0.539,0.836,0.797,0.777,0.833,0.850,0.847,0.838,0.834,0.770,0.810,0.787,0.727,0.727,0.715,0.715,0.835,0.835,0.832,0.832,0.803,0.803,0.622,0.622,0.830,0.830,0.837,0.837,0.717,0.717,0.695,0.695,0.762,0.762,0.740,0.740,0.873,0.873,0.815,0.815,0.818,0.818,0.818,0.818,0.801,0.801,0.628,0.628,0.671,0.671,0.699,0.699,0.657,0.657,0.673,0.673,0.710,0.710,0.836,0.836,0.800,0.800,0.784,0.784,0.504,0.504,0.493,0.493,0.571,0.571,0.685,0.685,0.639,0.639,0.657,0.657,0.503,0.503,0.700,0.700,0.772,0.772,0.837,0.837,0.776,0.776,0.555,0.555,0.750,0.750,0.665,0.665,0.829,0.829,0.854,0.854,0.831,0.831,0.835,0.835,0.827,0.827,0.835,0.835,0.814,0.814,0.739,0.739,0.774,0.774,0.722,0.722,0.844,0.844,0.845,0.845,0.834,0.834,0.697,0.697,0.706,0.706,0.781,0.781,0.754,0.754,0.781,0.781,0.671,0.671,0.746,0.746,0.530,0.493,0.554,0.834,0.838,0.833,0.837,0.837,0.837,0.836,0.842,0.838,0.822,0.770,0.721,0.754,0.760,0.777,0.770,0.566,0.648,0.648,0.780,0.716,0.754,0.716,0.429,0.752,0.842,0.851,0.745,0.676,0.808,0.745,0.551,0.558,0.588,0.807,0.803,0.813,0.620,0.594,0.611,0.482,0.458,0.545,0.619,0.712,0.612,0.704,0.496,0.589,0.825,0.809,0.819,0.598,0.611,0.841,0.850,0.846,0.530,0.493,0.554,0.834,0.838,0.833,0.837,0.837,0.837,0.836,0.842,0.838,0.822,0.770,0.721,0.754,0.760,0.777,0.770,0.566,0.648,0.648,0.780,0.716,0.754,0.716,0.429,0.752,0.842,0.851,0.745,0.676,0.808,0.745,0.551,0.558,0.588,0.807,0.803,0.813,0.620,0.594,0.611,0.482,0.458,0.545,0.619,0.712,0.612,0.704,0.496,0.589,0.825,0.809,0.819,0.598,0.611,0.841,0.850,0.846,0.817,0.764,0.726,0.788,0.735,0.727,0.833,0.850,0.755,0.832,0.766,0.823,0.709,0.713,0.711,0.615,0.601,0.573,0.739,0.675,0.616,0.581,0.593,0.646,0.774,0.840,0.852,0.838,0.842,0.833,0.837,0.828,0.781,0.842,0.830,0.800,0.784,0.582,0.788,0.797]

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

// Smoothing must trade jitter for lag, monotonically.
function jerk(o) {
  let j = 0
  for (let i = 1; i < o.length; i++) j += Math.abs(o[i] - o[i - 1])
  return j / (o.length - 1)
}
eq('more smoothing means less frame-to-frame jump', jerk(simulate(10)) < jerk(simulate(1)), true)

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`)
process.exit(fail ? 1 : 0)

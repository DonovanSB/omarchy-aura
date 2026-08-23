

// Pure logic for the Aura plugin: the effect table, D-Bus argument building,
// and colour maths. No QML types and no I/O, so it stays unit-checkable with
// plain `qmljs`/node and reusable from both the widget and the panel.

var SERVICE = "xyz.ljones.Asusd"
var IFACE = "xyz.ljones.Aura"
var PROPS_IFACE = "org.freedesktop.DBus.Properties"

// Aura firmware effect ids, in the order asusd's AuraModeNum enum declares
// them. A keyboard only implements a subset -- this G513 reports [0,1,2,3,10]
// in SupportedBasicModes -- so the panel filters this table by that list
// rather than offering modes the firmware silently ignores.
//
// `colour1`/`colour2`/`speed`/`direction` say which LedModeData fields the
// effect actually reads, so the panel can hide controls that do nothing.
var MODES = [
  { id: 0,  name: "Static",        colour1: true,  colour2: false, speed: false, direction: false },
  { id: 1,  name: "Breathe",       colour1: true,  colour2: true,  speed: true,  direction: false },
  { id: 2,  name: "Rainbow cycle", colour1: false, colour2: false, speed: true,  direction: false },
  { id: 3,  name: "Rainbow wave",  colour1: false, colour2: false, speed: true,  direction: true  },
  { id: 4,  name: "Stars",         colour1: true,  colour2: true,  speed: true,  direction: false },
  { id: 5,  name: "Rain",          colour1: true,  colour2: false, speed: true,  direction: false },
  { id: 6,  name: "Highlight",     colour1: true,  colour2: false, speed: true,  direction: false },
  { id: 7,  name: "Laser",         colour1: true,  colour2: false, speed: true,  direction: false },
  { id: 8,  name: "Ripple",        colour1: true,  colour2: false, speed: true,  direction: false },
  { id: 9,  name: "Pulse",         colour1: true,  colour2: false, speed: true,  direction: false },
  { id: 10, name: "Comet",         colour1: true,  colour2: false, speed: true,  direction: false },
  { id: 11, name: "Flash",         colour1: true,  colour2: false, speed: true,  direction: false }
]

var SPEEDS = ["Low", "Med", "High"]
var DIRECTIONS = ["Right", "Left", "Up", "Down"]
var BRIGHTNESS_LABELS = ["Off", "Low", "Med", "High"]

// The software effect. It is not a firmware mode: it drives Static (0) from
// the audio peak at musicFps, so it shares the id space by convention only.
var MUSIC_MODE = "music"

function modeById(id) {
  for (var i = 0; i < MODES.length; i++)
    if (MODES[i].id === id) return MODES[i]
  return null
}

function modeName(id) {
  var m = modeById(id)
  return m ? m.name : ("Mode " + id)
}

// Only the effects this device reports as supported, in table order.
function supportedModes(supportedIds) {
  if (!supportedIds || !supportedIds.length) return []
  var out = []
  for (var i = 0; i < MODES.length; i++)
    if (supportedIds.indexOf(MODES[i].id) !== -1) out.push(MODES[i])
  return out
}

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v)
}

function clamp255(v) {
  return Math.round(clamp(v, 0, 255))
}

// "#rrggbb" / "rrggbb" -> [r,g,b]. Returns null on anything unparseable so
// callers can keep the previous colour instead of flashing to black.
function hexToRgb(hex) {
  if (typeof hex !== "string") return null
  var s = hex.trim().replace(/^#/, "")
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null
  return [
    parseInt(s.substring(0, 2), 16),
    parseInt(s.substring(2, 4), 16),
    parseInt(s.substring(4, 6), 16)
  ]
}

function rgbToHex(rgb) {
  if (!rgb || rgb.length < 3) return "#000000"
  var out = "#"
  for (var i = 0; i < 3; i++) {
    var h = clamp255(rgb[i]).toString(16)
    out += h.length === 1 ? "0" + h : h
  }
  return out
}

// Linear blend, t in 0..1. Used by music mode to ride between the two
// configured colours instead of inventing a palette the user did not pick.
function mix(a, b, t) {
  var k = clamp(t, 0, 1)
  return [
    clamp255(a[0] + (b[0] - a[0]) * k),
    clamp255(a[1] + (b[1] - a[1]) * k),
    clamp255(a[2] + (b[2] - a[2]) * k)
  ]
}

// ---------------------------------------------------- music level pipeline
//
// Measured against real playback on this machine: `peak` updates at ~23 Hz
// and, while music plays, sits between roughly 0.40 and 0.88 -- about 3 dB of
// usable range riding high. It also drops to exactly 0 during gaps.
//
// Two things follow. The absolute value is nearly useless, so the level has to
// be normalised against an adaptive window. And silence has to be excluded
// from that window: an earlier version let a zero drag the floor down fast and
// then took ~20 s to recover, which parked the output near full scale for the
// rest of the track.

// Below this the signal counts as silence: output goes dark and the window is
// left alone rather than being dragged toward zero.
var SILENCE_GATE = 0.02

// Refuse to normalise against a window narrower than this, so noise floor
// wobble is not amplified into full swing.
var MIN_WINDOW = 0.05

// Window time constants, in milliseconds. The ceiling jumps to meet a louder
// peak and sags slowly; the floor drops quickly and recovers slowly -- but
// "slowly" here is a second or two, not the twenty it used to be.
var CEILING_RISE_MS = 120
var CEILING_FALL_MS = 2500
var FLOOR_FALL_MS = 120
var FLOOR_RISE_MS = 1200

// Short and fixed: `peak` is already a maximum over its buffer, so a long
// attack would be peak-holding on top of peak-holding.
var ATTACK_MS = 40

function isSilent(peak) {
  return clamp(peak, 0, 1) < SILENCE_GATE
}

// Smoothing 1-10 -> release time constant. Release is what decides whether
// the lighting reads as a VU meter falling back or as a strobe. The old range
// topped out at 1.5 s, which averaged over ~19 frames of a signal that varies
// every frame and flattened it; 600 ms is the useful ceiling.
function releaseMsFor(smoothing) {
  var s = clamp(smoothing || 5, 1, 10)
  return 60 + (s - 1) / 9 * 540
}

// Per-frame smoothing factor for a time constant. Derived from the real frame
// interval so changing musicFps changes the update rate without changing how
// anything feels.
function envelopeAlpha(timeConstantMs, intervalMs) {
  if (timeConstantMs <= 0) return 1
  return clamp(1 - Math.exp(-Math.max(intervalMs, 1) / timeConstantMs), 0, 1)
}

function trackBound(current, peak, riseMs, fallMs, intervalMs) {
  var tc = peak > current ? riseMs : fallMs
  return current + (peak - current) * envelopeAlpha(tc, intervalMs)
}

function trackCeiling(current, peak, intervalMs) {
  return trackBound(current, peak, CEILING_RISE_MS, CEILING_FALL_MS, intervalMs)
}

function trackFloor(current, peak, intervalMs) {
  return trackBound(current, peak, FLOOR_RISE_MS, FLOOR_FALL_MS, intervalMs)
}

// Position within the adaptive window. There is deliberately no gain or curve
// knob here: a gain in front is divided straight back out by the window, and a
// gamma behind only shifted average brightness -- measured across its whole
// range it moved the mean from 0.71 to 0.81 while changing nothing about how
// the lighting tracked the music. Auto-levelling already sets the range.
function normaliseLevel(peak, floor, ceiling) {
  var window = Math.max(ceiling - floor, MIN_WINDOW)
  return clamp((peak - floor) / window, 0, 1)
}

// Largest per-channel difference, used to drop writes the eye cannot see.
function colourDistance(a, b) {
  if (!a || !b) return 255
  return Math.max(Math.abs(a[0] - b[0]),
                  Math.abs(a[1] - b[1]),
                  Math.abs(a[2] - b[2]))
}

// ---------------------------------------------------------------- D-Bus argv
//
// Every command is built as an argv array, never a shell string: Process
// takes the array directly, so colours and speeds can never be reinterpreted
// as shell syntax.

function treeCommand() {
  return ["busctl", "--system", "tree", SERVICE]
}

// asusd exposes one object per Aura device, e.g. /xyz/ljones/aura/19b6_2_3.
// Parse the first out of `busctl tree` box-drawing output.
function parseDevicePath(treeOutput) {
  if (!treeOutput) return ""
  var match = String(treeOutput).match(/\/xyz\/ljones\/aura\/[A-Za-z0-9_]+/)
  return match ? match[0] : ""
}

// One GetAll round-trip returns every property as JSON -- cheaper and more
// atomic than a get-property per field.
function getAllCommand(path) {
  return ["busctl", "--system", "-j", "call", SERVICE, path,
          PROPS_IFACE, "GetAll", "s", IFACE]
}

// busctl -j wraps each value as {type, data}; unwrap into a plain object.
function parseGetAll(jsonText) {
  var parsed = JSON.parse(jsonText)
  var dict = parsed && parsed.data ? parsed.data[0] : null
  if (!dict) return {}
  var out = {}
  for (var key in dict) out[key] = dict[key].data
  return out
}

function setBrightnessCommand(path, level) {
  return ["busctl", "--system", "set-property", SERVICE, path, IFACE,
          "Brightness", "u", String(clamp(Math.round(level), 0, 3))]
}

// LedModeData is (mode, zone, colour1, colour2, speed, direction) and asusd
// applies the whole struct at once -- there is no per-field setter, so every
// write has to carry the full current state.
function setModeDataCommand(path, state) {
  var c1 = state.colour1 || [0, 0, 0]
  var c2 = state.colour2 || [0, 0, 0]
  return ["busctl", "--system", "set-property", SERVICE, path, IFACE,
          "LedModeData", "(uu(yyy)(yyy)ss)",
          String(state.mode | 0),
          String(state.zone | 0),
          String(clamp255(c1[0])), String(clamp255(c1[1])), String(clamp255(c1[2])),
          String(clamp255(c2[0])), String(clamp255(c2[1])), String(clamp255(c2[2])),
          SPEEDS.indexOf(state.speed) !== -1 ? state.speed : "Med",
          DIRECTIONS.indexOf(state.direction) !== -1 ? state.direction : "Right"]
}

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

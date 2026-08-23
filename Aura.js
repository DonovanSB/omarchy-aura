.pragma library

// Pure logic for the Aura plugin: the effect table, D-Bus argument building,
// and colour maths. No QML types and no I/O, so it stays unit-checkable with
// plain `qmljs`/node and reusable from both the widget and the panel.

var SERVICE = "xyz.ljones.Asusd"
var IFACE = "xyz.ljones.Aura"
var PROPS_IFACE = "org.freedesktop.DBus.Properties"

// Firmware effect ids, in asusd's AuraModeNum order. A keyboard implements
// only a subset, so the panel filters this by SupportedBasicModes. The flags
// say which LedModeData fields each effect reads, so the panel can hide
// controls that would do nothing.
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

// The software effect. Not a firmware mode -- it drives Static (0).
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

// "#rrggbb" / "rrggbb" -> [r,g,b], or null so callers can keep the previous
// colour instead of flashing to black.
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

// Linear blend, t in 0..1.
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
// Measured on real playback: `peak` updates at ~23 Hz and sits between ~0.40
// and ~0.88 while music plays -- about 3 dB of usable range, riding high --
// dropping to exactly 0 in gaps. So the absolute value is near useless and
// everything hangs on normalising against an adaptive window, with silence
// excluded from it.

// Below this the signal counts as silence: output goes dark, window untouched.
var SILENCE_GATE = 0.02

// Never normalise against a narrower window, or noise becomes full swing.
var MIN_WINDOW = 0.05

// Window time constants (ms). The ceiling jumps to a louder peak and sags;
// the floor drops fast and recovers over a second or two.
var CEILING_RISE_MS = 120
var CEILING_FALL_MS = 2500
var FLOOR_FALL_MS = 120
var FLOOR_RISE_MS = 1200

// Fixed and short: `peak` is already a per-buffer maximum, so a long attack
// would be peak-holding twice.
var ATTACK_MS = 40

function isSilent(peak) {
  return clamp(peak, 0, 1) < SILENCE_GATE
}

// Smoothing 1-10 -> release time constant, the knob that decides VU meter
// versus strobe. Past ~600 ms it averages the signal flat.
function releaseMsFor(smoothing) {
  var s = clamp(smoothing || 5, 1, 10)
  return 60 + (s - 1) / 9 * 540
}

// Per-frame factor for a time constant, derived from the real interval so
// changing fps does not change how it feels.
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

// Position within the adaptive window. No gain or curve knob on purpose: a
// gain in front is divided back out by the window, and a gamma behind only
// shifts average brightness.
function normaliseLevel(peak, floor, ceiling) {
  var window = Math.max(ceiling - floor, MIN_WINDOW)
  return clamp((peak - floor) / window, 0, 1)
}

// Largest per-channel difference; drops writes the eye cannot see.
function colourDistance(a, b) {
  if (!a || !b) return 255
  return Math.max(Math.abs(a[0] - b[0]),
                  Math.abs(a[1] - b[1]),
                  Math.abs(a[2] - b[2]))
}

// ---------------------------------------------------------------- D-Bus argv
//
// Always an argv array, never a shell string, so a colour can never be
// reinterpreted as shell syntax.

function treeCommand() {
  return ["busctl", "--system", "tree", SERVICE]
}

// First device object out of `busctl tree` box-drawing output.
function parseDevicePath(treeOutput) {
  if (!treeOutput) return ""
  var match = String(treeOutput).match(/\/xyz\/ljones\/aura\/[A-Za-z0-9_]+/)
  return match ? match[0] : ""
}

// One GetAll round-trip returns every property as JSON.
function getAllCommand(path) {
  return ["busctl", "--system", "-j", "call", SERVICE, path,
          PROPS_IFACE, "GetAll", "s", IFACE]
}

// busctl -j wraps each value as {type, data}.
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

// (mode, zone, colour1, colour2, speed, direction). asusd has no per-field
// setter, so every write carries the full state.
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

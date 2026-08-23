import QtQuick
import Quickshell.Services.Pipewire
import "Aura.js" as Aura

// Audio-reactive lighting. The firmware has no music effect, so this
// synthesises one: sample the default sink's peak, smooth it, and drive
// Static colour at `fps`.
Item {
  id: root

  required property var device
  property bool active: false
  property int smoothing: 3
  property int fps: 25

  // Quiet sits at colour2, peaks at colour1.
  property var lowColour: [0, 0, 0]
  property var highColour: [255, 255, 255]

  // Smoothed 0..1 level: short attack so beats land, long release so it reads
  // as a VU meter rather than a strobe.
  property real level: 0

  readonly property int intervalMs: Math.max(1000 / Math.max(fps, 1), 12)
  readonly property real attackAlpha: Aura.envelopeAlpha(Aura.ATTACK_MS, intervalMs)
  readonly property real releaseAlpha: Aura.envelopeAlpha(Aura.releaseMsFor(smoothing), intervalMs)

  // Frames whose colour is visually identical are dropped.
  property var _lastSent: null
  readonly property int deadband: 3

  // Adaptive window the level is normalised against.
  property real _floor: 0
  property real _ceiling: 0
  property bool _windowSeeded: false

  // This component only drives. `active` also tracks device readiness and
  // settings reloads, so it blips without the user doing anything -- nothing
  // that owns configuration may hang off it.
  onActiveChanged: {
    if (device) {
      device.driving = active
      // Start from the device's real state: brightness decides whether this
      // driver writes at all, and it may have changed elsewhere.
      if (active) device.refresh()
    }
    level = 0
    _lastSent = null
    _windowSeeded = false
  }

  // An unbound node reports no peaks.
  PwObjectTracker {
    objects: Pipewire.defaultAudioSink ? [Pipewire.defaultAudioSink] : []
  }

  PwNodePeakMonitor {
    id: monitor
    node: Pipewire.defaultAudioSink
    // Sampling audio has a real cost, so only run it while music mode is on.
    enabled: root.active && Pipewire.defaultAudioSink !== null
  }

  Timer {
    running: root.active && root.device && root.device.ready
    interval: root.intervalMs
    repeat: true
    onTriggered: {
      var peak = monitor.peak
      var target

      if (Aura.isSilent(peak)) {
        // Go dark, but leave the window alone: a gap dragging the floor down
        // parks the output near full scale for the rest of the track.
        target = 0
      } else {
        if (!root._windowSeeded) {
          root._floor = peak
          root._ceiling = peak
          root._windowSeeded = true
        }
        root._ceiling = Aura.trackCeiling(root._ceiling, peak, root.intervalMs)
        root._floor = Aura.trackFloor(root._floor, peak, root.intervalMs)
        target = Aura.normaliseLevel(peak, root._floor, root._ceiling)
      }

      var k = target > root.level ? root.attackAlpha : root.releaseAlpha
      root.level = root.level + (target - root.level) * k

      var colour = Aura.mix(root.lowColour, root.highColour, root.level)
      if (root._lastSent && Aura.colourDistance(colour, root._lastSent) < root.deadband) return
      root._lastSent = colour
      root.device.pushColour(colour)
    }
  }
}

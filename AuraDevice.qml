import QtQuick
import Quickshell.Io
import "Aura.js" as Aura

// Owns the conversation with asusd. Everything goes through `busctl`, since
// Quickshell 0.3 has no generic D-Bus client: a round-trip is ~11 ms and the
// device sustains ~83 writes/second. No sudo needed -- asusd's polkit policy
// covers the active session.
Item {
  id: root

  // ---------------------------------------------------------------- state
  readonly property bool ready: _devicePath !== "" && _loaded
  readonly property string lastError: _lastError

  // -1 means "not read yet"; a plausible default made the guards optimistic
  // before the first refresh landed.
  property int brightness: -1
  property int mode: 0
  property int zone: 0
  property var colour1: [255, 255, 255]
  property var colour2: [0, 0, 0]
  property string speed: "Med"
  property string direction: "Right"

  // Set while a software effect is writing frames. What is on the bus is then
  // transient, so a refresh must not adopt it as configuration.
  property bool driving: false

  property var supportedModes: []
  property var supportedBrightness: [0, 1, 2, 3]

  signal refreshed()

  property string _devicePath: ""
  property bool _loaded: false
  property string _lastError: ""

  // Newest frame queued while a write is in flight. Older frames have no
  // value, so only one is kept rather than a backlog of processes.
  property var _pendingColour: null

  // ------------------------------------------------------------ discovery
  Component.onCompleted: discover()

  function discover() {
    treeProc.running = true
  }

  Process {
    id: treeProc
    command: Aura.treeCommand()
    stdout: StdioCollector {
      onStreamFinished: {
        var path = Aura.parseDevicePath(text)
        if (path === "") {
          root._lastError = "No Aura device exposed by asusd"
          return
        }
        root._devicePath = path
        root.refresh()
      }
    }
    stderr: StdioCollector {
      onStreamFinished: if (text.trim() !== "") root._lastError = text.trim()
    }
  }

  // --------------------------------------------------------------- reading
  function refresh() {
    if (_devicePath === "") return
    readProc.running = false
    readProc.command = Aura.getAllCommand(_devicePath)
    readProc.running = true
  }

  Process {
    id: readProc
    stdout: StdioCollector {
      onStreamFinished: {
        if (text.trim() === "") return
        var props
        try {
          props = Aura.parseGetAll(text)
        } catch (e) {
          root._lastError = "Could not parse asusd state: " + e
          return
        }
        root._applyProps(props)
      }
    }
    stderr: StdioCollector {
      onStreamFinished: if (text.trim() !== "") root._lastError = text.trim()
    }
  }

  function _applyProps(props) {
    if ("Brightness" in props) brightness = props.Brightness
    if ("SupportedBasicModes" in props) supportedModes = props.SupportedBasicModes
    if ("SupportedBrightness" in props) supportedBrightness = props.SupportedBrightness

    // LedModeData carries the colours; LedMode alone does not.
    if (!driving) {
      var data = props.LedModeData
      if (data && data.length >= 6) {
        mode = data[0]
        zone = data[1]
        colour1 = data[2]
        colour2 = data[3]
        speed = data[4]
        direction = data[5]
      } else if ("LedMode" in props) {
        mode = props.LedMode
      }
    }

    _lastError = ""
    _loaded = true
    refreshed()
  }

  // --------------------------------------------------------------- writing
  function setBrightness(level) {
    if (_devicePath === "") return
    brightness = Aura.clamp(Math.round(level), 0, 3)
    brightnessProc.running = false
    brightnessProc.command = Aura.setBrightnessCommand(_devicePath, brightness)
    brightnessProc.running = true
  }

  Process {
    id: brightnessProc
    stderr: StdioCollector {
      onStreamFinished: if (text.trim() !== "") root._lastError = text.trim()
    }
  }

  // asusd has no partial setter, so overrides are merged into the full
  // struct. At brightness 0 the state is recorded but not written -- see
  // pushColour.
  function applyMode(overrides) {
    if (_devicePath === "") return
    var o = overrides || {}
    if ("mode" in o) mode = o.mode
    if ("zone" in o) zone = o.zone
    if ("colour1" in o) colour1 = o.colour1
    if ("colour2" in o) colour2 = o.colour2
    if ("speed" in o) speed = o.speed
    if ("direction" in o) direction = o.direction
    if (brightness <= 0) return
    _write(mode, colour1)
  }

  // Static plus a colour, with backpressure instead of a queue. Nothing is
  // written at brightness 0: asusd restores the brightness on any write while
  // the LEDs are off, so 25 frames a second would undo "off" permanently.
  function pushColour(rgb) {
    if (_devicePath === "" || !rgb) return
    if (brightness <= 0) {
      _pendingColour = null
      return
    }
    if (writeProc.running) {
      _pendingColour = rgb
      return
    }
    _write(0, rgb)
  }

  function _write(modeId, rgb) {
    writeProc.running = false
    writeProc.command = Aura.setModeDataCommand(_devicePath, {
      mode: modeId,
      zone: root.zone,
      colour1: rgb,
      colour2: root.colour2,
      speed: root.speed,
      direction: root.direction
    })
    writeProc.running = true
  }

  Process {
    id: writeProc
    onExited: {
      // Send the frame that arrived mid-write.
      if (root.brightness <= 0) root._pendingColour = null
      if (root._pendingColour) {
        var next = root._pendingColour
        root._pendingColour = null
        root._write(0, next)
      }
    }
    stderr: StdioCollector {
      onStreamFinished: if (text.trim() !== "") root._lastError = text.trim()
    }
  }
}

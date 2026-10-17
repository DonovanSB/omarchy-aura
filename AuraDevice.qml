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

  // A level set by something other than this plugin, the keyboard keys above
  // all. asusd has already been told by the time it fires.
  signal brightnessChangedOutside(int level)

  property string _devicePath: ""
  property bool _loaded: false
  property string _lastError: ""

  // Newest write queued while another is in flight. Older ones have no value,
  // so only one is kept rather than a backlog of processes.
  property var _pending: null

  // What the keyboard shows (last read back or written) and the level asusd
  // has stored (last written), so repeats can be skipped.
  property var _shown: null
  property int _asusdBrightness: -1

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
    // A brightness write still in flight makes this reading stale.
    if ("Brightness" in props && !brightnessProc.running) brightness = props.Brightness
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
        _shown = _state(mode, colour1)
      } else if ("LedMode" in props) {
        mode = props.LedMode
      }
    }

    // The keyboard keys bypass asusd, so its stored level can fall behind.
    // Realign it before any effect write can bring that level back.
    if (brightness >= 0) setBrightness(brightness)

    _lastError = ""
    _loaded = true
    refreshed()
  }

  // --------------------------------------------------------------- writing
  function setBrightness(level) {
    if (_devicePath === "") return
    var next = Aura.clamp(Math.round(level), 0, 3)
    if (next === brightness && next === _asusdBrightness) return
    brightness = next
    _asusdBrightness = next
    brightnessProc.running = false
    brightnessProc.command = Aura.setBrightnessCommand(_devicePath, brightness)
    brightnessProc.running = true
  }

  Process {
    id: brightnessProc
    // Deferred: a restart kills the old process, which lands here before the
    // new one is running.
    onExited: Qt.callLater(root._flush)
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
    // Rewriting what is already showing would only restart the animation.
    if (!_pending && Aura.sameEffect(_shown, _state(mode, colour1))) return
    _write(mode, colour1)
  }

  function _state(modeId, rgb) {
    return {
      mode: modeId,
      zone: root.zone,
      colour1: rgb,
      colour2: root.colour2,
      speed: root.speed,
      direction: root.direction
    }
  }

  // Static plus a colour, with backpressure instead of a queue. Nothing is
  // written at brightness 0: asusd restores the brightness on any write while
  // the LEDs are off, so 25 frames a second would undo "off" permanently.
  function pushColour(rgb) {
    if (_devicePath === "" || !rgb) return
    if (brightness <= 0) {
      _pending = null
      return
    }
    if (writeProc.running) {
      _pending = { mode: 0, colour: rgb }
      return
    }
    _write(0, rgb)
  }

  // asusd re-applies its stored brightness on every effect write, so a write
  // that overtook a brightness change would flash the old level.
  function _write(modeId, rgb) {
    if (brightnessProc.running) {
      _pending = { mode: modeId, colour: rgb }
      return
    }
    // Every write carries the full state, so anything still queued is stale.
    _pending = null
    _shown = _state(modeId, rgb)
    writeProc.running = false
    writeProc.command = Aura.setModeDataCommand(_devicePath, _shown)
    writeProc.running = true
  }

  // Sends the write that queued up behind one in flight.
  function _flush() {
    if (brightness <= 0) _pending = null
    if (!_pending || writeProc.running || brightnessProc.running) return
    var next = _pending
    _pending = null
    _write(next.mode, next.colour)
  }

  Process {
    id: writeProc
    onExited: Qt.callLater(root._flush)
    stderr: StdioCollector {
      onStreamFinished: if (text.trim() !== "") root._lastError = text.trim()
    }
  }

  // ------------------------------------------------------- outside changes
  // Brightness changes that skip asusd, which emits nothing for them: the
  // kernel handling the keyboard keys, or a script writing the LED class
  // device. The brightness file also changes on every asusd write, so only a
  // level that differs from the last one written counts.
  FileView {
    path: Aura.LED_PATH + "/brightness"
    watchChanges: true
    printErrors: false
    // text() is stale inside the change signal itself.
    onFileChanged: reload()
    // Mid-write the file may still hold the old level; the write's own change
    // follows.
    onLoaded: if (!brightnessProc.running) root._ledChanged(Aura.levelFromLed(text()))
  }

  // The kernel reports key presses here, never in the file above. Read from
  // here too: an effect write can overwrite the brightness file before it is
  // read, but not this one.
  FileView {
    property bool pressed: false
    path: Aura.LED_PATH + "/brightness_hw_changed"
    watchChanges: true
    printErrors: false
    onFileChanged: { pressed = true; reload() }
    // The first load holds whatever the last press was, not news.
    onLoaded: {
      if (!pressed) return
      pressed = false
      root._ledChanged(Aura.levelFromLed(text()))
    }
  }

  function _ledChanged(level) {
    if (!ready || level < 0 || level === brightness) return
    // Through asusd, so its stored level matches too.
    setBrightness(level)
    brightnessChangedOutside(level)
  }
}

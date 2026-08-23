import QtQuick
import qs.Commons
import qs.Ui
import "Aura.js" as Aura

// Control surface for the Aura keyboard. Reached from the bar pill, from
// `omarchy-shell shell toggle donovan.aura`, or from an omarchy-menu entry.
Panel {
  id: root
  moduleName: "donovan.aura"
  ipcTarget: "donovan.aura"
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null

  // The bar identifies panels by the widget in its slot, not by this panel.
  readonly property var barIdentity: hostWidget || root

  // ------------------------------------------------------------- settings
  readonly property bool followTheme: setting("followTheme", false) === true
  readonly property bool musicMode: setting("musicMode", false) === true
  readonly property int musicSmoothing: Number(setting("musicSmoothing", 3))
  readonly property int musicFps: Number(setting("musicFps", 25))

  // Applies locally, then lets the bar write through to shell.json.
  function persistSettings(values) {
    // updateEntryInline replaces the whole entry, so writing before settings
    // are bound would erase every key it already has.
    if (!root.settingsLoaded && root.hostWidget) return

    var entry = { id: root.moduleName }
    for (var existing in root.settings) if (existing !== "id") entry[existing] = root.settings[existing]
    for (var key in values) entry[key] = values[key]

    // The host widget binds `settings` back down here, so assigning to both
    // would fight that binding.
    if (root.hostWidget && "settings" in root.hostWidget) root.hostWidget.settings = entry
    else root.settings = entry

    // The bar is not wired the instant this panel is built; hold the write
    // rather than dropping it.
    if (canPersist()) root.bar.shell.updateEntryInline(root.moduleName, entry)
    else root._pendingEntry = entry
  }

  property var _pendingEntry: null

  function canPersist() {
    return root.bar && root.bar.shell
      && typeof root.bar.shell.updateEntryInline === "function"
  }

  function flushPendingEntry() {
    if (!root._pendingEntry || !canPersist()) return
    var entry = root._pendingEntry
    root._pendingEntry = null
    root.bar.shell.updateEntryInline(root.moduleName, entry)
  }

  onBarChanged: flushPendingEntry()

  // ------------------------------------------------------ panel lifecycle
  function open() {
    setCenterHoverRevealSuppressed(false)
    root.controller.show()
    device.refresh()
  }

  function openFromHotkey() {
    root.controller.show()
    device.refresh()
    // Deferred: showing hands over the popout coordinator, which clears this
    // flag as it closes the previous panel.
    Qt.callLater(function() {
      if (root.opened) setCenterHoverRevealSuppressed(true)
    })
  }

  function close() {
    setCenterHoverRevealSuppressed(false)
    root.controller.hide()
  }

  function toggle() {
    if (root.opened) root.close()
    else root.openFromHotkey()
  }

  function switchPanel(direction) {
    if (root.bar && typeof root.bar.switchPanelFrom === "function")
      return root.bar.switchPanelFrom(root.barIdentity, direction)
    return false
  }

  function setCenterHoverRevealSuppressed(value) {
    if (root.bar && "centerHoverRevealSuppressed" in root.bar)
      root.bar.centerHoverRevealSuppressed = value
  }

  // Level to come back to after a right-click switch-off. Persisted for the
  // same reason brightness is: a widget rebuild would otherwise forget it.
  readonly property int restoreBrightness: Number(setting("restoreBrightness", 2))

  // Right-click on the pill is the device's main toggle, the way it is for
  // audio, bluetooth and tailscale. Like mute, it restores the previous level
  // rather than jumping to a fixed one.
  function toggleLights() {
    var current = root.brightnessNow()
    if (current > 0) root.applyEffect({ brightness: 0 }, { restoreBrightness: current })
    else root.applyEffect({ brightness: Math.max(1, root.restoreBrightness) })
  }

  // Middle-click on the pill steps through the levels the device reports.
  function stepBrightness() {
    var levels = device.supportedBrightness
    if (!levels || !levels.length) return
    var index = levels.indexOf(root.brightnessNow())
    root.applyEffect({ brightness: levels[(index + 1) % levels.length] })
  }

  // The bar pill reads these back off the panel.
  readonly property string label: device.ready
    ? (musicMode ? "Music" : Aura.modeName(root.effectState.mode))
    : ""
  readonly property bool deviceReady: device.ready

  // Drives the bar icon: it shows its colours when the keyboard is lit and
  // goes flat when it is not.
  readonly property bool lightsOn: device.ready && brightnessNow() > 0

  // ---------------------------------------------------------- device layer
  AuraDevice { id: device }

  MusicDriver {
    id: music
    device: device
    active: root.musicMode && device.ready && root.configuredBrightness > 0
    smoothing: root.musicSmoothing
    fps: root.musicFps
    // From the persisted effect, never the device: `driving` freezes device
    // state while music runs, so those values go stale.
    lowColour: root.effectState.colour2
    highColour: root.activeColour1
  }

  function setMusicMode(enabled) {
    if (enabled === root.musicMode) return
    root.persistSettings({ musicMode: enabled })
  }

  // Persisted as the user chooses it, not snapshotted when music starts: a
  // settings change rebuilds the widget, so there is no reliable instant to
  // read the pre-music state. Merges into the record rather than reading the
  // device, which is frozen while music runs.
  function applyEffect(overrides, extras) {
    var base = root.effectState
    var next = {
      mode: base.mode,
      colour1: base.colour1,
      colour2: base.colour2,
      speed: base.speed,
      direction: base.direction,
      brightness: root.brightnessNow()
    }
    for (var key in overrides) next[key] = overrides[key]

    var values = { effect: next }
    for (var extra in (extras || {})) values[extra] = extras[extra]
    root.persistSettings(values)

    device.setBrightness(next.brightness)
    if (next.brightness > 0) device.applyMode(next)
  }

  readonly property var configuredEffect: setting("effect", null)

  // Whether the bar has handed over `settings` yet. Not a key count: the bar
  // strips `id`, so a brand new entry legitimately arrives empty and counting
  // would treat it as never loaded.
  property bool settingsLoaded: false
  onSettingsChanged: {
    settingsLoaded = true
    seedConfiguredEffect()
  }

  // What the panel shows and acts on. Read this rather than the device, which
  // is frozen while music runs.
  readonly property var effectState: root.configuredEffect ? root.configuredEffect : ({
    mode: device.mode,
    colour1: device.colour1,
    colour2: device.colour2,
    speed: device.speed,
    direction: device.direction,
    brightness: device.brightness
  })

  // Brightness is persisted too; on the device alone it was lost on every
  // rebuild. Two forms on purpose: the property is for bindings, the function
  // for imperative code, which must not read a derived binding that its own
  // change handler can reach before re-evaluation.
  function brightnessNow() {
    var e = root.configuredEffect
    var b = e ? e.brightness : undefined
    return (b === undefined || b === null || b < 0) ? device.brightness : b
  }

  readonly property int configuredBrightness: {
    var b = root.effectState.brightness
    return (b === undefined || b === null || b < 0) ? device.brightness : b
  }

  function setFollowTheme(enabled) {
    if (enabled === root.followTheme) return
    root.persistSettings({ followTheme: enabled })
  }

  // Nothing is written at brightness 0: asusd switches the LEDs back on for
  // any effect write while they are off.
  function pushEffect() {
    if (root.musicMode || !configReady || root.brightnessNow() <= 0) return
    device.applyMode({
      mode: root.effectState.mode,
      colour1: root.activeColour1,
      colour2: root.effectState.colour2,
      speed: root.effectState.speed,
      direction: root.effectState.direction
    })
  }

  onActiveColour1Changed: pushEffect()

  // Brightness is orthogonal to which effect runs, so it has its own path --
  // pushEffect returns early during music and would never apply it.
  function pushBrightness() {
    if (!device.ready) return
    var b = root.brightnessNow()
    if (b >= 0) device.setBrightness(b)
  }

  onConfiguredBrightnessChanged: {
    pushBrightness()
    pushEffect()
  }

  // First run: adopt what the device reports. Skipped whenever the device is
  // showing something derived (music frames, theme colour) rather than a
  // deliberate choice.
  function seedConfiguredEffect() {
    if (!root.settingsLoaded || root.followTheme) return
    if (root.configuredEffect || root.musicMode || device.driving || !device.ready) return
    // Effects that never read colour2 report leftover noise for it; black is
    // the useful default for music's quiet colour.
    var mode = Aura.modeById(device.mode)
    var usesColour2 = mode ? mode.colour2 : false

    root.persistSettings({
      effect: {
        mode: device.mode,
        colour1: device.colour1,
        colour2: usesColour2 ? device.colour2 : [0, 0, 0],
        speed: device.speed,
        direction: device.direction,
        brightness: device.brightness
      }
    })
  }

  readonly property bool configReady: device.ready
    && root.configuredEffect !== null
    && root.configuredEffect !== undefined

  // The device answering and the settings arriving are independent events in
  // either order, so both drive the apply. Signals, not a combined binding:
  // a binding whose first evaluation is already true never reports a change.
  onConfiguredEffectChanged: { pushBrightness(); pushEffect() }
  onMusicModeChanged: pushEffect()

  Connections {
    target: device
    function onRefreshed() {
      root.seedConfiguredEffect()
      root.pushBrightness()
      root.pushEffect()
    }
  }

  ThemeColour { id: theme }

  // The theme is a colour source, not a mode: it composes with every effect.
  // The manual colour stays recorded, so turning it off restores it.
  readonly property var themeColour: theme.colour
  readonly property var activeColour1: root.followTheme ? root.themeColour : root.effectState.colour1

  // Effects the firmware on this device actually implements.
  readonly property var availableModes: Aura.supportedModes(device.supportedModes)

  readonly property var currentMode: Aura.modeById(root.effectState.mode)

  // Music reads both colours and neither speed nor direction.
  readonly property bool showsColour1: root.musicMode || (currentMode ? currentMode.colour1 : false)
  readonly property bool showsColour2: root.musicMode || (currentMode ? currentMode.colour2 : false)
  readonly property bool showsSpeed: !root.musicMode && (currentMode ? currentMode.speed : false)
  readonly property bool showsDirection: !root.musicMode && (currentMode ? currentMode.direction : false)

  // Music belongs in the same list as the firmware effects: only one thing
  // can animate the keyboard at a time.
  function modeOptions() {
    var out = []
    for (var i = 0; i < availableModes.length; i++)
      out.push({ value: String(availableModes[i].id), label: availableModes[i].name })
    out.push({ value: Aura.MUSIC_MODE, label: "Music" })
    return out
  }

  readonly property string selectedMode: root.musicMode
    ? Aura.MUSIC_MODE
    : String(root.effectState.mode)

  function selectMode(value) {
    if (value === Aura.MUSIC_MODE) {
      root.setMusicMode(true)
      return
    }
    root.setMusicMode(false)
    root.applyEffect({ mode: parseInt(value, 10) })
  }

  // Quick picks: three from the live theme, then a fixed palette. Black is
  // offered only as a second colour -- as a main colour it lights nothing.
  function swatches(includeBlack) {
    var base = includeBlack ? ["#000000"] : []
    return base.concat([
      Aura.rgbToHex([Math.round(Color.accent.r * 255), Math.round(Color.accent.g * 255), Math.round(Color.accent.b * 255)]),
      Aura.rgbToHex([Math.round(Color.foreground.r * 255), Math.round(Color.foreground.g * 255), Math.round(Color.foreground.b * 255)]),
      Aura.rgbToHex([Math.round(Color.urgent.r * 255), Math.round(Color.urgent.g * 255), Math.round(Color.urgent.b * 255)]),
      "#ff0000", "#ff7f00", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff", "#ffffff"
    ])
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(360))
    // No explicit cap: fittedContentHeight already clamps to the space the
    // screen leaves for the card, and a fixed cap silently clipped the
    // music-mode sliders off the bottom once that section appeared.
    contentHeight: panel.fittedContentHeight(panelColumn.implicitHeight)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
    }

    Column {
      id: panelColumn
      width: parent.width
      spacing: Style.space(10)

      PanelSectionHeader { text: "Brightness" }

      ButtonGroup {
        width: parent.width
        options: [
          { value: "0", label: "Off" },
          { value: "1", label: "Low" },
          { value: "2", label: "Med" },
          { value: "3", label: "High" }
        ]
        value: String(root.configuredBrightness)
        onChanged: function(v) { root.applyEffect({ brightness: parseInt(v, 10) }) }
      }

      PanelSeparator { width: parent.width }

      PanelSectionHeader { text: "Effect" }

      Dropdown {
        width: parent.width
        label: "Mode"
        options: root.modeOptions()
        value: root.selectedMode
        onChanged: function(v) { root.selectMode(v) }
      }

      // Colour 1
      Column {
        width: parent.width
        spacing: Style.space(6)
        visible: root.showsColour1

        PanelSectionHeader {
          text: root.musicMode ? "Peak colour" : "Colour"
        }

        SwatchRow {
          width: parent.width
          colours: root.swatches(false)
          current: Aura.rgbToHex(root.activeColour1)

          showTheme: true
          themeColour: Aura.rgbToHex(root.themeColour)
          themeSelected: root.followTheme

          onThemePicked: root.setFollowTheme(true)
          onPicked: function(hex) {
            root.setFollowTheme(false)
            root.applyEffect({ colour1: Aura.hexToRgb(hex) })
          }
        }
      }

      // Colour 2 -- shown for two-colour firmware effects, and for music mode
      // where it is the floor the level rides up from.
      Column {
        width: parent.width
        spacing: Style.space(6)
        visible: root.showsColour2

        PanelSectionHeader {
          text: root.musicMode ? "Quiet colour" : "Second colour"
        }

        SwatchRow {
          width: parent.width
          colours: root.swatches(true)
          current: Aura.rgbToHex(root.effectState.colour2)
          onPicked: function(hex) { root.applyEffect({ colour2: Aura.hexToRgb(hex) }) }
        }
      }

      // Speed
      Column {
        width: parent.width
        spacing: Style.space(6)
        visible: root.showsSpeed

        PanelSectionHeader { text: "Speed" }

        ButtonGroup {
          width: parent.width
          options: [
            { value: "Low", label: "Slow" },
            { value: "Med", label: "Medium" },
            { value: "High", label: "Fast" }
          ]
          value: root.effectState.speed
          onChanged: function(v) { root.applyEffect({ speed: v }) }
        }
      }

      // Direction
      Column {
        width: parent.width
        spacing: Style.space(6)
        visible: root.showsDirection

        PanelSectionHeader { text: "Direction" }

        ButtonGroup {
          width: parent.width
          options: [
            { value: "Right", label: "Right" },
            { value: "Left", label: "Left" },
            { value: "Up", label: "Up" },
            { value: "Down", label: "Down" }
          ]
          value: root.effectState.direction
          onChanged: function(v) { root.applyEffect({ direction: v }) }
        }
      }

      PanelSeparator { width: parent.width }

      // Smoothing, with a live level readout so it can be tuned against
      // whatever is actually playing instead of guessing.
      Column {
        width: parent.width
        spacing: Style.space(6)
        visible: root.musicMode

        PanelSectionHeader { text: "Smoothing" }

        PanelSlider {
          width: parent.width
          bar: root.bar
          minimum: 1
          maximum: 10
          step: 1
          integer: true
          value: root.musicSmoothing
          onReleased: function(v) { root.persistSettings({ musicSmoothing: Math.round(v) }) }
        }
      }

      // ------------------------------------------------------------- status
      Text {
        width: parent.width
        visible: text !== ""
        text: device.ready ? device.lastError
                           : (device.lastError !== "" ? device.lastError : "Looking for an Aura device…")
        color: Color.urgent
        font.family: Style.font.family
        font.pixelSize: Style.font.caption
        wrapMode: Text.WordWrap
      }
    }
  }
}

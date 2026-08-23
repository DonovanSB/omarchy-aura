import QtQuick
import Quickshell.Io
import qs.Commons
import "Aura.js" as Aura

// Resolves the Omarchy theme to one keyboard colour. It only reports it --
// deciding whether to use it, and writing it, belongs to the panel.
//
// Themes may ship a `keyboard.rgb` holding one hex colour. Nothing in Omarchy
// 4 reads that file any more, so honouring it revives an existing convention.
// Themes without it fall back to the accent colour.
QtObject {
  id: root

  readonly property string themePath: Color.currentThemePath
  readonly property var colour: _fileColour ? _fileColour : _accentColour()

  property var _fileColour: null

  function _accentColour() {
    var c = Color.accent
    return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)]
  }

  property FileView keyboardRgb: FileView {
    path: root.themePath + "/keyboard.rgb"
    watchChanges: true
    // A theme without the file is the normal case.
    printErrors: false
    onLoaded: root._fileColour = Aura.hexToRgb(text())
    // `text()` is stale inside the change signal; reload and parse in
    // onLoaded, as Color.qml does.
    onFileChanged: reload()
    onLoadFailed: root._fileColour = null
  }
}

import QtQuick
import qs.Commons
import qs.Ui
import "Aura.js" as Aura

// Colour picker for one slot: swatches plus a hex field for anything else.
Column {
  id: root

  property var colours: []
  property string current: "#000000"

  // Leading chip tracking the theme. A swatch rather than a toggle, so the
  // choice is exclusive by construction and previews the colour.
  property bool showTheme: false
  property string themeColour: "#000000"
  property bool themeSelected: false

  signal picked(string hex)
  signal themePicked()

  // Derived from the width so the row always fits on one line: the count
  // varies and `Style.space` scales with the theme.
  readonly property int ringWidth: 2
  readonly property int cellSpacing: Style.space(4)
  readonly property int cellCount: colours.length + (showTheme ? 1 : 0)

  // Floor for a very narrow panel; the Flow wraps if it comes to that.
  readonly property int minCell: Style.space(16)

  readonly property int cellSize: Math.max(minCell,
    Math.floor((width - cellSpacing * Math.max(cellCount - 1, 0))
               / Math.max(cellCount, 1)))
  readonly property int dotSize: Math.max(1, cellSize - ringWidth * 2)

  readonly property color restingEdge: Qt.rgba(Color.popups.text.r,
                                               Color.popups.text.g,
                                               Color.popups.text.b, 0.25)

  spacing: Style.space(6)

  Flow {
    width: parent.width
    spacing: root.cellSpacing

    // Marked so it reads as "automatic", not as a fixed colour.
    SwatchCell {
      visible: root.showTheme
      size: root.cellSize
      dot: root.dotSize
      ringWidth: root.ringWidth
      colour: root.themeColour
      selected: root.themeSelected
      restingEdge: root.restingEdge
      glyph: ""
      onActivated: root.themePicked()
    }

    Repeater {
      model: root.colours

      SwatchCell {
        required property string modelData

        size: root.cellSize
        dot: root.dotSize
        ringWidth: root.ringWidth
        colour: modelData
        // The ring tracks the value, not the click, so a typed hex that
        // matches a swatch selects it.
        selected: !root.themeSelected
          && root.current.toLowerCase() === modelData.toLowerCase()
        restingEdge: root.restingEdge
        onActivated: root.picked(modelData)
      }
    }
  }

  TextField {
    id: hexField
    width: parent.width

    // Only resynced while idle, or it would rewrite text under the cursor.
    // Disabled under the theme, where an edit would not survive.
    enabled: !root.themeSelected
    opacity: root.themeSelected ? 0.5 : 1
    text: activeFocus ? text : root.current
    onAccepted: {
      var rgb = Aura.hexToRgb(text)
      if (rgb) root.picked(Aura.rgbToHex(rgb))
      else text = root.current
    }
  }
}

import QtQuick
import qs.Commons

// One colour swatch. Selection is a ring around the dot, not a thicker border
// on it: drawn on the panel background it reads the same against a white
// swatch and a black one.
Item {
  id: root

  // Always supplied by SwatchRow, which derives them from the panel width.
  property int size: 26
  property int dot: 22
  property color colour: "#000000"
  property bool selected: false
  property color restingEdge: "#40ffffff"
  property int ringWidth: 2
  // Mark for a swatch that means something other than a fixed colour.
  property string glyph: ""

  signal activated()

  width: size
  height: size

  // A Rectangle draws its border inside its bounds, so dot + 2*ringWidth
  // puts the ring flush against the dot.
  Rectangle {
    anchors.centerIn: parent
    width: root.dot + root.ringWidth * 2
    height: width
    radius: width / 2
    color: "transparent"
    border.width: root.ringWidth
    border.color: Color.popups.text
    visible: root.selected
  }

  Rectangle {
    id: swatch
    anchors.centerIn: parent
    width: root.dot
    height: root.dot
    radius: width / 2
    color: root.colour

    // Hairline, so a swatch matching the panel still has an edge.
    border.width: 1
    border.color: root.restingEdge

    Text {
      anchors.centerIn: parent
      visible: root.glyph !== ""
      text: root.glyph
      // Black or white, whichever this colour can carry.
      color: (0.299 * swatch.color.r + 0.587 * swatch.color.g
              + 0.114 * swatch.color.b) > 0.55 ? "#000000" : "#ffffff"
      font.family: Style.font.family
      font.pixelSize: Style.font.caption
    }
  }

  MouseArea {
    anchors.fill: parent
    cursorShape: Qt.PointingHandCursor
    onClicked: root.activated()
  }
}

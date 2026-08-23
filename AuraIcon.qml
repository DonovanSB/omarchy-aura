import QtQuick
import QtQuick.Shapes

// The Aura mark drawn as vector paths rather than loaded from
// assets/icon.svg. Qt's SVG renderer is unreliable at bar-slot sizes,
// so the geometry is reproduced here from the same 24x24 coordinates.
Item {
  id: root

  property real iconSize: 16

  // The ring reads as chrome rather than brand, so it follows the bar.
  property color frameColor: "#a3c863"

  // When set, the whole mark is painted flat in this colour instead of the
  // brand gradients.
  property color tint: "transparent"
  readonly property bool tinted: tint.a > 0

  width: iconSize
  height: iconSize
  implicitWidth: iconSize
  implicitHeight: iconSize

  // Authored in the SVG's 24x24 space and scaled to fit.
  readonly property real u: iconSize / 24

  Shape {
    anchors.fill: parent
    preferredRendererType: Shape.CurveRenderer
    transform: Scale { xScale: root.u; yScale: root.u }

    // Ring, open at the bottom. Heavier than the 1.65 the SVG uses: at
    // bar size that lands on ~1.1px and smears across two rows.
    ShapePath {
      fillColor: "transparent"
      strokeColor: root.frameColor
      strokeWidth: 2.0
      capStyle: ShapePath.FlatCap
      PathSvg { path: "M9.218 22.384a10.75 10.75 0 1 1 5.564 0" }
    }

    // The A, split down the middle so each leg carries its own gradient. The
    // SVG clips two gradient-filled rectangles to the letter outline;
    // splitting the outline is the same result without a clip.
    ShapePath {
      strokeWidth: 0
      fillColor: root.tinted ? root.tint : "transparent"
      fillGradient: root.tinted ? null : leftGradient
      PathSvg { path: "M11.1 5.2H12v1.85L7.05 18.8H5.2z" }
    }
    ShapePath {
      strokeWidth: 0
      fillColor: root.tinted ? root.tint : "transparent"
      fillGradient: root.tinted ? null : rightGradient
      PathSvg { path: "M12 5.2h.9L18.8 18.8h-1.85L12 7.05z" }
    }
    ShapePath {
      strokeWidth: 0
      fillColor: root.tinted ? root.tint : "transparent"
      fillGradient: root.tinted ? null : barGradient
      PathSvg { path: "M9.85 13.85h4.3l.7 1.6h-5.7z" }
    }
  }

  LinearGradient {
    id: leftGradient
    x1: 11.5; y1: 5.2; x2: 5.2; y2: 18.8
    GradientStop { position: 0.0; color: "#f239bd" }
    GradientStop { position: 0.48; color: "#9842eb" }
    GradientStop { position: 1.0; color: "#247bfa" }
  }

  LinearGradient {
    id: rightGradient
    x1: 12.5; y1: 5.2; x2: 18.8; y2: 18.8
    GradientStop { position: 0.0; color: "#f239bd" }
    GradientStop { position: 0.3; color: "#ff6a68" }
    GradientStop { position: 0.6; color: "#ffe344" }
    GradientStop { position: 1.0; color: "#79dd70" }
  }

  LinearGradient {
    id: barGradient
    x1: 9.15; y1: 14.65; x2: 14.85; y2: 14.65
    GradientStop { position: 0.0; color: "#438efa" }
    GradientStop { position: 0.52; color: "#55c7c8" }
    GradientStop { position: 1.0; color: "#8ddf70" }
  }
}

import QtQuick
import qs.Commons
import qs.Ui

// Bar pill for the Aura panel, following the first-party popup-widget
// contract (weather, audio, network): the panel lives in a Loader, and the
// open/close/opened surface is what `omarchy-shell shell toggle` routes to.
BarWidget {
  id: root
  moduleName: "donovan.aura"

  // anchorItem/hostWidget never change, so they are pushed once. bar and
  // settings are bound below instead: pushing them depends on whether the
  // assignment lands before or after the Loader finishes.
  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    if ("anchorItem" in target) target.anchorItem = button
    if ("hostWidget" in target) target.hostWidget = root
  }

  Binding {
    target: panelLoader.item
    property: "settings"
    value: root.settings
    when: panelLoader.item !== null
    restoreMode: Binding.RestoreNone
  }

  Binding {
    target: panelLoader.item
    property: "bar"
    value: root.bar
    when: panelLoader.item !== null
    restoreMode: Binding.RestoreNone
  }

  function togglePanel() {
    if (panelLoader.item && panelLoader.item.toggle) panelLoader.item.toggle()
  }

  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false

  function open() {
    if (panelLoader.item && panelLoader.item.openFromHotkey) panelLoader.item.openFromHotkey()
  }

  function close() {
    if (panelLoader.item && panelLoader.item.close) panelLoader.item.close()
  }

  // The bar prefers this over close when handing the popout slot on.
  readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false

  function closeForPopoutSwitch() {
    if (panelLoader.item) panelLoader.item.closeForPopoutSwitch()
  }

  // Hidden until asusd answers, so a machine with no Aura device shows no
  // dead pill.
  visible: panelLoader.item ? panelLoader.item.deviceReady === true : false
  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    // nf-md-keyboard (U+F030C).
    text: "\uDB80\uDF0C"
    slotSize: Style.bar.iconSlot
    tooltipText: panelLoader.item ? panelLoader.item.label : ""

    onPressed: function(b) {
      if (b === Qt.MiddleButton) root.cycleBrightness()
      else root.togglePanel()
    }
  }

  // Middle-click steps brightness without opening the panel.
  function cycleBrightness() {
    var panel = panelLoader.item
    if (!panel || !panel.deviceReady) return
    panel.stepBrightness()
  }
}

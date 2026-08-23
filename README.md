# Aura

ASUS Aura keyboard lighting for the Omarchy shell: the firmware effects your
device supports, an Omarchy theme colour source, and an audio-reactive music
mode.

Adds a keyboard pill to the bar. Clicking it opens the control panel.

## Requirements

- Omarchy 4 (Quattro)
- `asusctl` installed and `asusd` running
- An ASUS device exposing Aura over D-Bus

No sudo needed — asusd's polkit policy lets the active session control the
lighting. The plugin adds no system packages.

## Install

```bash
omarchy plugin add https://github.com/DonovanSB/omarchy-aura.git --enable --yes
```

Without `--yes` the command is interactive and lets you review the code before
enabling, which is worth doing: shell plugins run unsandboxed.

To place the pill somewhere specific:

```bash
omarchy bar move donovan.aura --section right
```

## Remove

```bash
omarchy plugin remove donovan.aura
```

To keep it installed but off the bar, use `omarchy plugin disable donovan.aura`.

## Using it

| Control | What it does |
|---|---|
| **Brightness** | Off / Low / Med / High |
| **Mode** | The firmware effects this device reports, plus **Music** |
| **Colour** | Swatches, any hex, or the theme chip |
| **Quiet colour** | Where music fades to between peaks |

The panel also opens from `omarchy-shell shell toggle donovan.aura '{}'`, so it
can be bound to a key in `~/.config/hypr/bindings.lua` or added to
`omarchy-menu.jsonc`. Middle-clicking the pill steps brightness.

Only the effects your firmware actually implements are listed. A different
ASUS board will show a different set.

### Theme colour

The first chip in the colour row follows the Omarchy theme. Themes may ship a
`keyboard.rgb`; those that don't fall back to their accent colour. It is a
colour source, not a mode, so it composes with every effect — including music,
where the theme colour becomes the peak.

Picking any other swatch turns it off and restores your manual colour.

### Music mode

There is no music effect in the firmware, so this one is software: it samples
the default audio **output** (not a microphone) and drives the lighting between
your quiet and peak colours.

One knob, **Smoothing** — how slowly the light falls back after a peak. Raise it
if it flickers, lower it if it feels sluggish. Everything else auto-levels.

Turning brightness off stops it, and nothing is written to the keyboard while
the lights are off.

## Scope

Built and tested on a ROG Strix G513RC (Omarchy 4.0.0, asusctl 6.3.8,
Quickshell 0.3.0). The code adapts to whatever the device reports, so other
Aura hardware should work, but none has been tested. Reports welcome.

## Development

`Aura.js` holds the pure logic and has no dependencies:

```bash
node tests/aura_test.js
omarchy plugin validate .
```

Saving any file under `~/.config/omarchy/plugins/` hot-reloads the plugin.

## License

MIT

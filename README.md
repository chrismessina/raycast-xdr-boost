# XDR Boost

Make SDR content brighter on XDR displays (the MacBook Pro's built-in Liquid Retina XDR and the Pro
Display XDR) by using their EDR headroom, controlled from Raycast.

## How it works

A small Swift helper, built from source in `swift/Sources/XDRBoostHelper/`, runs in the background while
the boost is on. It keeps each XDR panel in EDR mode with a 1×1 pixel window and scales the display's
gamma table by the chosen level. Turning the boost off quits the helper, and macOS restores the
original table the moment the helper exits, even if it crashes.

## Commands

- **XDR Boost** (menu bar): pick Off, Low, Medium, High or Max, see each display's status, stop the boost.
- **Toggle XDR Boost**: turn the boost on at your default level, or off.
- **Brighter** / **Dimmer**: step through the levels.

## Preferences

- **Default Level**: the level Toggle XDR Boost turns on (High by default).
- **After Restart**: off by default. When on, the menu bar command restarts the boost at your last
  level if the helper is gone, for example after a restart. Nothing else runs in the background:
  there is no login item and no LaunchAgent.

## Requirements

A Mac with an XDR display. Displays without EDR headroom are skipped.

## Credits

See [NOTICE.md](NOTICE.md).

#!/bin/bash
# fix-tray-menubar-cache.sh
#
# Repairs the macOS Control Center menu-bar cache when a tray (NSStatusItem)
# icon is invisible because its `menuItemLocations` array went MISSING in the
# trackedApplications blob. macOS 26 (Sequoia/Tahoe). See debug-learnings.md 2026-06-13.
#
# Root cause this fixes: each app entry in
#   ~/Library/Group Containers/group.com.apple.controlcenter/Library/Preferences/group.com.apple.controlcenter.plist
# needs BOTH isAllowed=true AND a non-empty `menuItemLocations`. If menuItemLocations
# is missing/empty, macOS knows the app is allowed but "forgot" it's allowed *in the
# menu bar*, so it parks the icon off-screen.
#
# CRITICAL GOTCHA: you MUST kill cfprefsd too — it caches this domain in memory and
# will OVERWRITE a direct file edit otherwise. Editing the plist + killing only
# ControlCenter does NOT stick (the daemon reverts it). Credit: Gemini found this.

set -euo pipefail

# Kill the preferences daemon AND Control Center so neither overwrites our edit.
killall cfprefsd ControlCenter 2>/dev/null || true

python3 << 'PYEOF'
import plistlib, os

PLIST_PATH = os.path.expanduser(
    "~/Library/Group Containers/group.com.apple.controlcenter/Library/Preferences/group.com.apple.controlcenter.plist"
)

with open(PLIST_PATH, 'rb') as f:
    data = plistlib.load(f)

# trackedApplications is a nested binary plist blob.
inner = plistlib.loads(bytes(data['trackedApplications']))

for entry in inner:
    if isinstance(entry, dict) and isinstance(entry.get('location'), dict):
        bundle = entry['location'].get('bundle', {}).get('_0')
        # dev (Electron) + production + local/test ToDoozy bundle ids
        if bundle in ('com.github.Electron', 'com.todoozy', 'com.todoozy.local', 'com.todoozy.dev'):
            # If the OS "forgot" the menu-bar location array, recreate it.
            if not entry.get('menuItemLocations'):
                entry['menuItemLocations'] = [{'bundle': {'_0': bundle}}]
                print(f"Repaired menuItemLocations for {bundle}")

data['trackedApplications'] = plistlib.dumps(inner, fmt=plistlib.FMT_BINARY)
with open(PLIST_PATH, 'wb') as f:
    plistlib.dump(data, f, fmt=plistlib.FMT_BINARY)
PYEOF

# Restart the daemons so macOS reads the repaired file.
killall cfprefsd ControlCenter 2>/dev/null || true
echo "Done. Quit + relaunch ToDoozy; the tray icon should reappear."

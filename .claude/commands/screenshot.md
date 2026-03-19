---
name: screenshot
description: Capture a screenshot of the running ToDoozy Electron app. Use this whenever you need to see the current state of the app, verify a visual change, check for UI bugs, or the user asks you to look at/screenshot/capture the app. Also triggers on "what does it look like", "show me the app", "check the UI", or similar.
---

# ToDoozy Screenshot

Capture and analyze the running ToDoozy Electron app window.

## How to Capture

Run this sequence:

```bash
# 1. Bring app to front and position it fully visible
osascript -e '
tell application "System Events"
  tell process "Electron"
    set frontmost to true
    set position of window 1 to {100, 50}
    set size of window 1 to {1200, 800}
  end tell
end tell'

# 2. If you need to see the DevTools console (e.g. checking for errors or reading diagnostic logs):
#    Toggle DevTools off then on to ensure Console is fresh and visible
#    Then switch to the Console tab with Cmd+Shift+J
osascript -e '
tell application "System Events"
  tell process "Electron"
    keystroke "i" using {command down, option down}
  end tell
end tell'
sleep 1
osascript -e '
tell application "System Events"
  tell process "Electron"
    keystroke "i" using {command down, option down}
  end tell
end tell'
sleep 1
# Switch to Console tab
osascript -e '
tell application "System Events"
  tell process "Electron"
    keystroke "j" using {command down, shift down}
  end tell
end tell'
sleep 1

# 3. Get the window ID and capture just the app window
WINID=$(swift -e '
import CoreGraphics
if let windowList = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] {
    for window in windowList {
        let owner = window["kCGWindowOwnerName"] as? String ?? ""
        let name = window["kCGWindowName"] as? String ?? ""
        if (owner.contains("Electron") || owner.contains("ToDoozy")) && name == "ToDoozy" {
            print(window["kCGWindowNumber"] as? Int ?? 0)
            break
        }
    }
}
')
screencapture -l "$WINID" /tmp/debug-screenshot.png
```

Then read `/tmp/debug-screenshot.png` with the Read tool to analyze it.

## When to Include DevTools

- **UI-only check**: Skip step 2. Just position, capture, analyze.
- **Checking for errors or reading diagnostic logs**: Include step 2 to open DevTools on the Console tab.

## What to Look For

When analyzing the screenshot:
- **UI**: Layout issues, overlapping elements, missing data, incorrect styling, empty states that shouldn't be empty
- **Console** (if visible): Red errors, yellow warnings, failed network requests, your diagnostic `console.log` output
- **General**: Does the app look like it's in a healthy state? Is the right view showing?

Describe what you see concisely — focus on anything unexpected or relevant to the current task.

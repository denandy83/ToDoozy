---
name: notary
description: Submit the ToDoozy DMG to Apple notarization. Use when the user wants to notarize the app, submit for notarization, or says "notarize", "/notary". Does NOT wait for completion — use /checknotary to poll status.
---

# Notarize ToDoozy

Submit the built DMG to Apple's notary service for notarization. This submits asynchronously (no --wait) so it returns immediately with a submission ID.

## Steps

1. Read `package.json` to get the current version
2. Verify the DMG exists at `dist/ToDoozy-{version}-arm64.dmg` — if not, tell the user to run `npm run dist:mac` first
3. Read `.env` in the project root and extract the credentials: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
4. Submit to notarization using Bash, passing the extracted credentials inline:

```
xcrun notarytool submit "dist/ToDoozy-${VERSION}-arm64.dmg" \
  --apple-id "${APPLE_ID}" \
  --password "${APPLE_APP_SPECIFIC_PASSWORD}" \
  --team-id "${APPLE_TEAM_ID}" 2>&1
```

5. Parse the submission ID from the output (looks like a UUID after `id:`)
6. Save the submission ID to `.notary-submission` so /checknotary can find it without the user having to remember it
7. Report the submission ID to the user and remind them to run `/checknotary` to check status

Do NOT use --wait. The whole point is to submit and return immediately.

---
name: checknotary
description: Check the status of an Apple notarization submission. Use when the user wants to check notarization status, says "check notary", "/checknotary", "is it notarized yet", "notary status". Optionally takes a submission ID as argument, otherwise reads from .notary-submission.
---

# Check Notarization Status

Check the status of a previously submitted notarization request.

## Arguments
- `$ARGUMENTS` — optional submission ID (UUID). If not provided, read it from `.notary-submission` in the project root.

## Steps

1. Determine the submission ID:
   - If `$ARGUMENTS` contains a UUID, use that
   - Otherwise, read `.notary-submission` from the project root
   - If neither exists, tell the user to run `/notary` first or provide an ID: `/checknotary <submission-id>`

2. Read `.env` in the project root and extract the credentials: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID

3. Check status using Bash, passing the extracted credentials inline:

```
xcrun notarytool info "<submission-id>" \
  --apple-id "${APPLE_ID}" \
  --password "${APPLE_APP_SPECIFIC_PASSWORD}" \
  --team-id "${APPLE_TEAM_ID}" 2>&1
```

4. Report the status to the user:
   - **In Progress** — tell them to check again later (`/checknotary`)
   - **Accepted** — notarization succeeded! Automatically staple it:
     - Read `package.json` to get the version
     - Run: `xcrun stapler staple "dist/ToDoozy-{version}-arm64.dmg"`
     - Then tell them they can upload with: `./scripts/release.sh upload`
     - Delete `.notary-submission` since it's done
   - **Invalid** / **Rejected** — fetch the log for details:
     ```
     xcrun notarytool log "<submission-id>" \
       --apple-id "${APPLE_ID}" \
       --password "${APPLE_APP_SPECIFIC_PASSWORD}" \
       --team-id "${APPLE_TEAM_ID}" 2>&1
     ```
     Show the user the relevant error details.

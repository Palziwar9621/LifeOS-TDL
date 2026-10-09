# Voice, onboarding and alarm release

## Delivered source changes
- Full-width Create new account button matching Continue as Guest.
- Non-blocking 15-topic tutorial, per-account progress, skip/restart and smart-add practice.
- Conversation starts idle. Tap the microphone to chat, or explicitly enable foreground wake mode. A microphone that is off cannot detect wake words.
- Shared validated client/backend contract: 68 bounded tools, including project/goal milestones, subtasks, tags, categories, planner blocks and task relationships.
- Requests can be interrupted; fetches and queued actions are cancelled, but completed writes are never silently undone. Actual write receipts override generated success prose.
- Android 1.3.0 (versionCode 21): app-owned PCM plus bundled Vosk US English, not system SpeechRecognizer. No recognition-service beeps or global audio muting. Model/license notices are packaged.
- Windows 1.2.0: durable alarm schedules, resume reconciliation and local selected-sound playback while running in tray.
- Android persisted alarm delivery, exact-permission fallback, reboot/time changes, sound foreground service, and recurring reminder advancement fixes.

## Actual checks
- `npm run typecheck`: passed.
- `npm test`: 68 passed.
- `node --test tests/android-speech-lifecycle.test.mjs tests/android-embedded-speech.test.mjs`: 5 passed.
- `node tests/android-speech-package.check.mjs`: passed, including model checksum, four ABIs, JNI/bridge retention and 64-bit 16 KB alignment.
- JDK 17 `gradlew.bat :app:assembleRelease :app:assembleDebug --console=plain --no-daemon`: passed.
- Desktop `npm run dist`: installer and portable built successfully; binaries are not Authenticode-signed.
- Web `npm run build`: passed, with existing CSS/chunk-size warnings.
- Local browser confirmed signup and guest buttons have matching full-width bounds. Guest interaction could not complete through browser control; no full UI smoke pass claimed.
- Supabase assistant deployed to the linked LifeOS project, ACTIVE version 11.

## Distribution
Windows binaries are served as `public/LifeOS-Setup.exe` and `public/LifeOS-Portable.exe`; download page uses same-site links.

Production at `https://life-os-tdl.vercel.app` updated through the existing GitHub integration. `node scripts/verify-production.mjs` passed: both Windows downloads returned HTTP 200 and matched the tested local SHA-256 hashes; the deployed app chunk contained the new wake/loading UI and granular tool contract. Vercel CLI credentials were unavailable, but no direct CLI deployment was needed.

Source commit: `b61ecee`; Windows distribution commit: `2ff09d8`. Separate Cloudflare configuration, marketing material and other unrelated local files were not published. Native artwork already present in the working tree was retained in this build and committed for reproducibility. Signing material is ignored and excluded from deployment.

Android 1.3.0 (versionCode 21) was signed through the original key's private console prompt. The signed release is `release/LifeOS-1.3.0.apk`, published as `public/LifeOS.apk`. `apksigner verify`, `zipalign -c -P 16 4`, package/version inspection and the speech packaging check passed. The SHA-256 signing certificate matches the previous public APK: `42553b2775c3ded1aedd5d66e42e00c5bedd04749b93c8aae2bf81da5991d6fd`. APK SHA-256: `192b3a826650d52c535bed65a65118e2095eb55b4edaf9b22b37264dcd302ed3`.

Use `scripts/sign-android-release.ps1` in an interactive terminal for this prepared release; it prompts privately and refuses a mismatched certificate. No password is stored in this repository. Install the signed release over the existing app without uninstalling. Real-device upgrade/data-retention testing is still outstanding.

## Honest limits and device acceptance
- No Android device was connected. Real speaker echo, accents, cold-load memory/latency, Doze/reboot and packaged Windows sound/resume require device testing.
- Android bundled ASR is US English. First model extraction/loading may take time and is shown explicitly. The model is roughly 41 MB compressed.
- Spoken interruption during TTS uses accepted interruption phrases (such as stop, wait, cancel or hey LifeOS) plus an echo guard. Arbitrary speech interruption and perfect echo separation are not guaranteed.
- Some controls remain UI-only: focus timer, app/account/device settings, permissions, attachments, ordering, archive/restore and fields not in the tool contract. Do not advertise unrestricted control of every feature.
- Android Force stop blocks alarms until app relaunch. Exact permission denial degrades timing. Recurring native snapshots currently cover seven days offline; reopen/sync the app to refresh them.
- Windows must remain running in tray; Quit, shutdown or sleep cannot produce an alarm at the scheduled instant. Resume can catch eligible missed alarms.
- Monthly/yearly reminder clamping follows the current stored due date; there is no immutable series-anchor field.

### Smoke checklist
1. Install the signed APK over the previous version without uninstalling; verify data remains.
2. Confirm launch is idle and permissions are requested only for selected features.
3. Enable wake mode, say the configured wake phrase, issue a task/milestone command, then interrupt with “wait” or “hey LifeOS”. Verify no stale second action occurs.
4. Test at least five listening/reply cycles on speaker and headset; check recognition-service tones are absent and alarm/music volume is unchanged.
5. Schedule alarms, close to tray/background, reboot Android, revoke/regrant exact permission, and test snooze/dismiss/update cancellation.
6. Test denied microphone permission, no TTS voice installed, first-use model load, airplane mode and low-memory resume.

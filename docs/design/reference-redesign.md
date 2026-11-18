# Snip AI reference redesign

## Visual sources
Sentio references 1–4: near-black navy, cyan overhead illumination, faint grids and stars, thin panel outlines, restrained radii. Reference 1 establishes the heading hierarchy; 2–4 establish grouped surfaces and small actions.
Unify references 5–6: electric blue primary actions, precise compact inputs, outlined secondary controls, consistent state colors. Reference 7: dense desktop settings, tables, dialogs and navigation.
The supplied 10-second navigation video shows a narrow black vertical rail, icons and a light hover label. Recreate its interaction with working app navigation, rather than playing the video as a nonfunctional navigation background.

## Active screen inventory
- Activation: key form, submitting, validation, success and recovery.
- Create empty: title, import/link input, download progress, errors, flow illustration.
- Create loaded: source filename, appearance player, frame/audio/clip length/text/logo tool panels, split crop controls, caption style browser, generation action bar.
- Processing: full-screen stage progress, metrics, cancellation and diagnostics.
- Generation complete: summary and preview action.
- Gallery: all clips, selection, exporting and empty/loading states.
- Preview editor: clip navigation, player, insights; captions/transcript/text/logo tabs, position and size inputs, save progress and errors.
- History: list, empty state, folder/preview actions and clear confirmation.
- Settings: defaults, hardware detection, storage, license and reset.
- Logout dialog: key confirmation, submitting and error.
- Shared: recovery panel, screen-crash fallback, background-error notice, selects, popovers and tooltips.

## Tokens and density
Defined in reference-studio.css. Spacing 4/8/12/16/20/24/32px; regular controls 34px; compact actions 28px; icon rail 44px; body 12–13px, labels 11px, page titles 28px. Larger headings only on empty import/activation. Primary blue, cyan focus, semantic amber/error/success remain distinct. Preserve video/caption artwork colors and media geometry.

## Constraints
Existing media/backend/license workflows stay in place. No network fonts, backdrop blur or animated full-window lighting. Ambient light is static CSS to avoid adding load during playback. Native OS file dialogs remain native. Window minimum is 1100×720; workspace settings/captions scroll independently and shorter windows retain accessible generation controls.

## Verification, 18 November 2026
TypeScript + Vite production build passed. Visually inspected in the native Electron window at approximately 1427×810: startup, empty create, navigation hover labels, settings, history rows, existing 60-clip preview, insights, caption/text editor tabs, local video import, loaded frame panel, audio panel and single-column caption previews. Fixed legacy-style specificity, settings header clipping, stretched hardware card, overly large empty-state panel and selected clip-count visibility. Native file-picker selection succeeded. Existing generated clips were used for editor inspection; a new full transcription/export was not run for this styling change. Activation and processing/completion state styles were updated in code but not all were triggered live.

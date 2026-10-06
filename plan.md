# Build plan — multi-agent-ensembles

| Field | Value |
|---|---|
| Topic | How to Successfully Manage Multi-Agent Ensembles |
| Topic slug | `multi-agent-ensembles` |
| Content version | 2 (`presentation-content.md`, APPROVED, Gate 3 approved) |
| Build version | 2 (rebuild of v1 `presentation/2026-10-06T0215-v1-multi-agent-ensembles/`, kept unchanged as reference) |
| Build folder | `presentation/2026-10-06T0316-v2-multi-agent-ensembles/` |
| Build start (UTC) | 2026-10-06T03:16:07Z |
| Brief | `brief.md` v3 (binding; visual preferences, scope and verified facts override builder defaults) |
| Initial theme | **Ensemble** (`:root` + `[data-theme="ensemble"]`, default when `pres-theme` unset) |
| Extra themes | GitHub Cosmos, Warm, Corporate, Cyberpunk (contract token values) |
| Canvas | 1920×1080, scaled to viewport, black letterbox |
| Fonts | Bundled offline via `@fontsource/*`: Nunito, Space Grotesk, Inter, JetBrains Mono, Playfair Display |

## Sections and slide ranges (26 slides)

| Section label (bottom-left chrome) | Slides |
|---|---|
| Opening | 1–3 |
| The evolution of agentic systems | 4–7 |
| Challenges → benefits | 8–11 |
| The main components | 12–13 |
| Example workflow | 14–16 |
| Specialized agents | 17–19 |
| Reviews, controls & guardrails | 20–21 |
| Orchestration & workflows | 22–23 |
| Close | 24–26 |

Slide counter (bottom-right): `N / 26`.

## Slide inventory

| # | Type | Treatment | Steps | Hand-crafted |
|---|---|---|---|---|
| 1 | title-slide | Title bottom-left (100px), eyebrow, speaker line; glowing orb cluster top-right (breathing, drift, travelling light) | – | ✅ |
| 2 | image-placeholder | Name 100px + role + line left; circular photo with cyan ring glow right | – | – |
| 3 | image-placeholder | "Let's connect", LinkedIn QR on 600px white rounded tile, name under | – | – |
| 4 | transition | Section: 120px cyan words | – | – |
| 5 | diagram | Four quarter cards (2023–2026) with SVG scenes that grow; each scene draws in | 4 | ✅ |
| 6 | single-point | Accent slide: full accent-surface background (#22D3EE in Ensemble), ink text, 120px | – | – |
| 7 | diagram | Hand-drawn SVG log-scale chart from METR TH 1.1 frontier data (15 pts); line draws in, dots appear as reached, anchors + hollow "16 h+" marker last | – | ✅ |
| 8 | transition | Section | – | – |
| 9 | boxes | Four-lens grid, amber/problem icons | 4 | ✅ |
| 10 | transition | Section | – | – |
| 11 | boxes | Identical four-lens grid, cyan/benefit icons | 4 | ✅ |
| 12 | transition | Section | – | – |
| 13 | boxes | Three vertical panels with icons (orb + badge, shield + check, connected orbs) | – | ✅ |
| 14 | transition | Section | – | – |
| 15 | diagram | Big title; workflow group (3 stage cards with create/review pills + arrows, line, small line) | 2 | ✅ |
| 16 | image-placeholder | GitHub-dark #0D1117 surface, official lockup (1000px, unmodified), one line | – | – |
| 17 | transition | "Component 1 of 3" eyebrow, 120px words, you-are-here strip | – | ✅ |
| 18 | boxes | Four ingredient columns (sheet, plug, dial, orb in dashed box) | – | ✅ |
| 19 | comparison | Amber mega-agent (wobble) vs four lean cyan specialists | – | ✅ |
| 20 | transition | "Component 2 of 3" + strip | – | ✅ |
| 21 | boxes | Four control columns (review orbs, terminal, lock, person at gate) | 4 | ✅ |
| 22 | transition | "Component 3 of 3" + strip | – | ✅ |
| 23 | comparison | Orchestrator card (dispatching orb) and Workflows card (stacked steps) | 2 | ✅ |
| 24 | single-point | "Questions?" 120px + orb cluster | – | ✅ |
| 25 | image-placeholder | "Let's connect" + thank-you line, QR 560px tile, name + title | – | – |
| 26 | title-slide | Mirrors slide 1 with "Thank you" | – | ✅ |

- Visual / diagram slides: 5, 7, 9, 11, 13, 15, 18, 19, 21, 23 (+ orb-cluster art on 1, 24, 26; you-are-here strip on 17, 20, 22).
- Code slides: none. Demo-placeholder slides: none (demos are off-slide; scripts in notes of 16, 19, 21, 23). Break slides: none.
- Image slides: 2 (`miguel-martinez.jpg`), 3 and 25 (`linkedin-qr.png`), 16 (`github-copilot-lockup-white.svg`).

## Hand-crafted approach

All illustrations are inline SVG using shared gradients (`#g-orb`, `#g-halo`, `#g-orb-problem`, `#g-halo-problem`) defined once in `index.html`; every fill/stroke uses theme variables (`--accent-benefit`, `--accent-problem`, `--orb-core`, `--figure`, `--line-soft` …) so the art re-tints for every theme. Agents = glowing orbs (radial gradient + soft halo); person = rounded figure; connectors = soft quadratic curves with travelling light dots (CSS dash animation, `.travel.motion-only`). Every hand-crafted slide file starts with `<!-- HAND-CRAFTED OVERRIDE — do not regenerate -->`.

## Reveal (D3) contract

- Article `data-steps="N"`; revealable elements `data-step="k"`. Slides 5 (4), 9 (4), 11 (4), 15 (2), 21 (4), 23 (2).
- Pending = `.is-pending` (≈17% opacity, grayscale), same layout box. Forward entry = step 1; backward arrival = final step; Home/End/go-to/checklist = step 1.
- Only the newly revealed element animates (fade/rise + SVG draw-in of `.draw`, pop of `.pop`).
- Print shows final state. Test API: `goToSlideInstant(n, step?)`, `setStep`, `getStep`, `getStepCount`, `waitForIdle` (waits for reveals/chart).

## Motion

GSAP slide transitions by type; CSS ambient motion (orb breathing, cluster drift, travelling dots, ring rotation, mega-agent wobble) on decorative SVG layers only (transform-only). All disabled under `prefers-reduced-motion: reduce`; ambient paused on inactive slides.

## Images

Copy every file in project-root `presentation-images/` to `public/images/` and cross-check: `miguel-martinez.jpg` → 2, `linkedin-qr.png` → 3, 25, `github-copilot-lockup-white.svg` → 16 (used unmodified).

## Implementation notes

- Fit target: content inside 56px top / 120px bottom / ≥100px side padding; chrome at 26px from bottom. Designed to the >40px clear-margin band; visual reviewer must confirm.
- Slide 7 chart: SVG 1680×560 user units = px; x domain 2023-01-01 → 2026-06-01, y log domain 2.5 → 2000 min; ticks 6 min / 1 h / 4 h / 16 h; shaded ≥16 h band; solid line points 1–14; hollow "16 h+" marker for point 15; no license label.
- No raw ASCII diagrams, no code blocks (deck has no code).
- Validation build to `.validation-dist` then deleted; no `dist/` left.

## Rebuild v2 — surgical fixes for review round 1 (agent-reviews/2026-10-06-presentation-slide-reviewer-multi-agent-ensembles.md)

Every hand-crafted visual keeps its v1 structure and markers; no content, order, type, section or notes changes.

| Finding | Change |
|---|---|
| F1 muted 24px text (7 citation, 15 small line, 23 subtitles) | New per-theme `--text-caption` token (Ensemble `#B7C3D6`, Cosmos .62, Warm .72, Corporate .70, Cyberpunk .62 alpha) used by `.chart-citation`, `.small-line`, `.duo-sub`; ≥5.2:1 on slide and card surfaces in all five themes |
| F2 Warm/Corporate secondary body | New `--text-body` token for all body/secondary text (slides, notes `.sn-meta`, panel hints); Warm .75 / Corporate .72 alpha (≥5.7 / ≥6.5:1); contract `--text-secondary` values untouched |
| F3 Warm accent text | New `--accent-text` token for every accent-coloured text (years, card names, eyebrows, section words, settings headings, ▶ buttons, notes header); Warm `#8f531a` (≥5.07:1 incl. selected checklist row and notes band); Warm focus ring `#8f531a`; decorative amber unchanged |
| F4 slide 5 row overflow | All card grids use `repeat(N, minmax(0, 1fr))`; slide 5 scene SVG fluid (`width:100%; max-width:336px; aspect-ratio:360/280`) |
| F5 idle controls / touch | Removed idle fade of `#top-controls` (rest opacity .78); arrows persistent (.82) under `(hover: none), (pointer: coarse)` |
| F6 counter with hidden slides | Counter = position in visible list / visible total (e.g. 14 / 25); checklist, go-to and notes keep source numbers |
| M1–M3 baselines | Reserved equal label regions: slide 13 titles and slide 18 labels (2 lines), slide 21 labels (3 lines) |
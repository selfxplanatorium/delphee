# UI design notes

Delphee includes an Italian browser interface for the JSON API. These notes describe the interface that is currently implemented. The source files remain the final reference.

## Source files

| File | Purpose |
| --- | --- |
| `src/server/static/index.html.ts` | HTML shell, navigation, login form, and content panels |
| `src/server/static/app.js` | Session handling, API calls, rendering, theme selection, and mobile navigation |
| `src/server/static/styles.css` | Design tokens, layout, components, responsive rules, and motion |
| `src/server/static/delphee-mark.svg` | Delphee mark and favicon |
| `src/server/static/film-grain.png` | Procedural high-contrast raster texture used only by the login atmosphere |

The build copies the static files into `dist/server/static` without bundling or transpiling them.

## Layout

Desktop uses a fixed 240-pixel sidebar and a centered content area with a maximum width of 880 pixels. At 900 pixels or narrower, the sidebar is replaced by a top bar and a modal navigation drawer.

The interface groups pages around student tasks:

- Overview
- Exams and exam sessions
- Enrollment and study plan
- Fees
- Documents
- Student services

Tables can scroll horizontally on small screens. The login screen remains separate from the authenticated application shell.

### Login route: cinematic exception

The unauthenticated login is a route-specific cinematic brand surface, not a redesign of the authenticated application. It fills the viewport on ordinary desktop and mobile screens (`100dvh`, contained paint, no page scroll) and vertically centers the complete brand-and-form stack as one composition; only viewports 700 pixels tall or shorter switch to top alignment and may scroll vertically so the form remains reachable. The centered login column is at most 390 pixels wide, while the oversized Delphee wordmark is the primary focal point.

Do not transfer this composition, dark ground, atmospheric effects, or display scale into the authenticated shell. Its fixed sidebar, centered 880-pixel content area, neutral reading surfaces, component hierarchy, and responsive drawer remain the governing system after authentication.

## Color and type

The interface uses a green brand color with neutral light and dark surfaces. Status colors have matching background tokens for success, warning, error, and information states.

The stylesheet requests these web fonts from Google Fonts:

- Fraunces for display text
- Hanken Grotesk for interface text
- Spline Sans Mono for identifiers and numeric data

System fallbacks remain available when the font request fails.

On the login route, Fraunces is deliberately pushed to an exceptional `clamp(6rem, 15vw, 13rem)` at weight 700 with tight tracking. Its desktop/mobile line heights (`0.92`/`0.94`) and the subtitle's explicit top margin are coupled safeguards against collision. The subtitle preserves its authored capitalization; do not force lowercase. The existing Delphee SVG mark remains above the name.

Light and dark themes follow the operating-system preference until the user chooses a theme. The explicit choice is stored in `localStorage` under `dw-theme`.

The login ignores the app theme and uses a dark green-black ground with near-white type. Four diffuse green orb layers create depth behind the content. A high-contrast procedural raster at `/static/film-grain.png` repeats across a fixed, viewport-sized overlay at 0.22 opacity with overlay blending. This material belongs to the login route alone.

## Components

The interface uses a small set of shared CSS classes for:

- Buttons and icon buttons
- Form fields and filters
- Data tables and responsive rows
- Status labels
- Summary cards
- Service and certificate lists
- Toast messages
- Loading, empty, and error states

Data rendering stays in `app.js`. Add a new visual pattern only when an existing component cannot express the required state.

The login form is intentionally uncarded. Preserve the existing fields, labels, supporting copy, links, submit control, validation, autocomplete, semantics, and session behavior. The translucent dark inputs and primary action may adapt to the cinematic ground, but the form must not become a floating card or split-screen panel.

## Interaction

Navigation changes the visible panel without a page reload. Each panel loads its data on demand and can request a refresh. The current navigation item uses `aria-current="page"`.

The mobile drawer:

- Opens from the menu button
- Moves focus to its close button
- Closes from the backdrop, close button, or Escape key
- Updates `aria-expanded` on the menu button

The theme toggle and current-page refresh controls are available in the mobile top bar.

The login's four orbs move independently on alternating 8, 10, 12, and 9 second cycles. Grain changes `background-position` on a 220ms stepped loop rather than translating an oversized layer; this keeps the texture lively without creating overflow. Submission retains its staged text, button sheen, and breathing mark feedback. Under `prefers-reduced-motion`, global motion collapses to an effectively static presentation and the submission sheen/breath are removed; do not remove the atmospheric layers themselves.

## Accessibility provisions

The current interface includes:

- A skip link to the main content
- Visible `:focus-visible` outlines
- Labels and autocomplete values on login fields
- Text labels for status values
- ARIA labels on icon-only controls
- An `aria-live` region for toast messages
- Reduced animation under `prefers-reduced-motion`
- A modal role and label on the mobile drawer

These provisions have not been presented as a formal accessibility audit or compliance claim. Test keyboard navigation, screen-reader output, zoom, and contrast when changing the interface.

The login's decorative atmosphere is `aria-hidden` and never carries meaning. Maintain viewport containment at standard sizes: verified desktop (1904×1080) and mobile (390×844) captures have `scrollHeight === innerHeight`.

## Change the interface

Keep CSS tokens in `:root` and their dark-theme overrides together. Reuse existing spacing, radius, type, and color variables before adding a new value.

After a change:

1. Run `npm run build`.
2. Start the server with `npm run dev`.
3. Test the demo account at desktop and mobile widths.
4. Check keyboard focus, the mobile drawer, both themes, and reduced motion.
5. For login changes, also verify desktop and 390-pixel mobile captures, exact viewport containment, short-height scrolling, title/subtitle separation, and that grain motion does not change layout or overflow.

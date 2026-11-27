# Validation record

Validated on 17 November 2026 using Node.js 24 on Windows and Chromium through Playwright.

## Latest revision: live-first UI and Gemini

- **39/39 automated tests passed** after the server and recommendation refactor, including Gemini quota failures, blocked/truncated responses and emergency handling with unavailable live data.
- The 24 decision-engine tests were rerun after the final edits and passed.
- The redesigned desktop (1440 × 1000) and mobile (390 × 844) were opened in Chromium with actual live air data. No JavaScript errors or mobile horizontal overflow were observed in that visual check.
- The local Gemini key is configured and ignored by Git; its value was never printed or committed.
- **Pending:** a real Gemini response with that key, the full browser regression suite and a new accessibility audit after the redesign. The execution environment's automatic approval review hit a usage limit before the regression command ran. These checks are not represented as completed.
- The results below document the previous published UI; they are useful regression baselines, not certification of the redesigned UI.

## Automated suite

`npm run verify`: **34/34 tests passed**, syntax checks passed, source-size budget passed. These tests run without API credentials and mock external providers. HTTP integration tests use real ephemeral localhost servers.

The first sandboxed run could not connect to localhost (`EACCES`); rerunning with localhost network permission passed. This was an execution-environment restriction, not a suppressed test failure.

## Browser acceptance checks

Passed in a visible Chromium browser:

- Desktop overview at 1440 × 1080 and mobile layout at 390 × 844.
- No horizontal document overflow on the mobile viewport.
- Household changes alter commute and purifier recommendations.
- Daily action completion survives reload.
- City switching changes category and recommendations (Delhi / Chennai scenarios).
- Contextual local-guide responses, including child/school guidance.
- HTML-like chat input remains literal text; no injected image element.
- Impact distance changes recompute the carbon scenario.
- Daily-plan export triggers a correctly named download.
- Simulated live-data outage produces unavailable values, a visible error and no silent demo substitution.
- Mobile household and chat dialogs open; Escape dismisses dialogs.
- No uncaught browser JavaScript errors during these flows.

## Accessibility

axe-core via `@axe-core/playwright`, rules tagged WCAG 2 A/AA and WCAG 2.1 AA:

| Surface          | Final automated violations |
| ---------------- | -------------------------: |
| Today’s overview |                          0 |
| My daily plan    |                          0 |
| A healthier home |                          0 |
| My impact        |                          0 |
| Household dialog |                          0 |
| Assistant dialog |                          0 |

The first audit identified insufficient contrast in secondary labels and step numbers. Those colors were corrected and all listed surfaces re-audited. Keyboard dismissal and mobile overflow were separately checked. Automated testing is not a full accessibility certification; screen-reader testing with multiple assistive technologies remains future work.

## External integrations

- Actual Open-Meteo request returned HTTP 200 and 48 hourly values.
- Browser live mode successfully rendered a real modelled US AQI reading with source/time labeling.
- The original AI adapter was tested with mocked successful, failed and empty responses. It has now been replaced with Gemini; see the latest revision above for current verification status.
- GitHub repository visibility was checked through the public API.

## Reproduction and artifacts

Core tests are committed under `test/`. Browser checks were executed using temporary Playwright scripts, as required by the browser-automation environment. Their screenshots and temporary QA dependencies are excluded under `artifacts/`; the README preview is a selected screenshot only.

To repeat browser acceptance testing, follow the steps above against `npm start`. Automated DOM audits complement, rather than replace, functional tests. No scores, carbon savings, usage metrics or successful competition submissions are fabricated.

Station-source update: 44 automated tests pass, including station provenance, stale/future/distant data rejection, unsafe attribution links, pollutant subindex handling and separation of model forecasts. A live token check returned Mandir Marg station data on 17 November 2026; readings can differ from city aggregates and other providers.

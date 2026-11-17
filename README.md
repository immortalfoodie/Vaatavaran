# Vaatavaran

**A little clarity in the air.** An explainable, context-aware Urban Air Quality Assistant for families and communities navigating winter smog.

Challenge 06 · Urban Air Quality Assistant · [Public repository](https://github.com/immortalfoodie/Vaatavaran)

![Vaatavaran dashboard showing a clearly labeled Delhi demo scenario, personalized priorities and an hourly outlook](docs/preview.png)

## Run in under a minute

Requires **Node.js 22.9+** (Node 24 recommended) and Git. No dependency installation, framework build, database, or account is needed for the demo.

```sh
git clone https://github.com/immortalfoodie/Vaatavaran.git
cd Vaatavaran
npm start
```

Open **http://localhost:3000**. The app starts in prominently labeled **demo mode**, so evaluation is reproducible even without network access or an API key. Select **Live air data** to fetch modelled conditions. Live-data failures never silently substitute demo readings.

```sh
npm run verify   # syntax, 34 automated tests, and source-size budget
npm run dev      # restart the server when source files change
```

## Chosen vertical and persona

**Urban Air Quality Assistant.** The primary persona is an urban Indian household balancing school, work, exercise, indoor air and a limited budget during winter smog. A secondary persona is a neighbour or community organizer sharing practical, low-emission habits.

The goal is to turn “AQI is high” into **what to change, why it matters, and what trade-offs remain**. The app supports New Delhi, Mumbai, Bengaluru, Kolkata, Lucknow and Chennai, with city-local time throughout.

## What works

- **Today’s overview:** US AQI, categories, PM2.5/PM10 concentrations, source/time labels and a 12-hour outlook with an accessible data table.
- **Personalized daily plan:** movement, commute and home actions respond to household sensitivity, travel mode, total daily distance, purifier access, budget and preferred exercise time.
- **Explainable decisions:** every plan action includes its rationale and its practical exposure or emissions impact. A lower forecast value is never presented as automatically safe.
- **A healthier home:** practical source control, ventilation and filtration guidance, with no-cost options first when appropriate.
- **Impact calculator:** inspect the assumptions behind an illustrative car-to-transit carbon comparison. Estimates are never represented as measured savings or health improvements.
- **Contextual assistant:** optional real generative AI, with a clearly labeled deterministic local guide when disabled or unavailable. Emergency symptom patterns bypass AI.
- **Daily checklist:** browser-local progress; resets when household context changes. Plain-text household and community exports omit explicit health preferences.
- **Accessible interface:** semantic landmarks, native controls, keyboard navigation, visible focus, modal dialogs with Escape dismissal, status announcements, text labels in addition to color, reduced-motion support and responsive layouts.

## Enable generative AI

Copy `.env.example` to `.env`, enter your own OpenAI API key **locally**, then restart the server:

```dotenv
OPENAI_API_KEY=your-key-here
OPENAI_MODEL=gpt-4.1-mini
```

Open **Ask Vaatavaran** and opt into **Use generative AI**. This uses the OpenAI Responses API. Model availability depends on your account; `OPENAI_MODEL` is configurable. The key stays on the server and `.env` is ignored by Git. Never paste real keys into source code or commit them.

AI receives the question, selected city, normalized household preferences, server-fetched air data and the deterministic plan. It is instructed to explain grounded actions without inventing measurements, diagnoses, reductions or citations. Responses are plain text, not interpreted as HTML. The independent rule-based plan remains available because prompt instructions are not a guarantee against incorrect generated advice.

**Without a key, the local guide is functional but is not generative AI.** Provider responses and failure handling are integration-tested with mocks. A paid live AI request requires your own configured key and opt-in; no real key is included in this submission.

## Approach and decision logic

```text
City + data mode → validated air data → deterministic recommendation engine
                                              ↑
                              household preferences
                                              ↓
                     daily plan + reasons + transparent impact
                                              ↓
                  optional AI explanation / labeled local guide
```

| Context                             | Decision                                           | Reason                                             |
| ----------------------------------- | -------------------------------------------------- | -------------------------------------------------- |
| US AQI 151+                         | Move strenuous activity indoors                    | Reduce polluted-air exposure for everyone          |
| US AQI 101+ and sensitive household | Apply stricter activity guidance                   | Sensitive groups warrant earlier precautions       |
| US AQI 201+                         | Postpone nonessential journeys                     | Avoid optimizing carbon at the expense of exposure |
| Low budget, no purifier             | Prioritize source control and damp dusting         | Useful actions without assuming purchasing power   |
| Purifier available                  | Use a correctly sized particle cleaner as directed | Adapt to equipment already owned                   |
| Missing live data                   | Show unavailable and local-monitoring guidance     | Unknown air is not clean air                       |
| AI unavailable / no consent         | Clearly labeled local guide                        | Preserve utility without pretending AI succeeded   |

Categories are **US AQI**, as supplied by Open-Meteo: 0–50, 51–100, 101–150, 151–200, 201–300, 301–500. They are **not India’s National AQI categories**. PM values are displayed in µg/m³ and are not converted into a second incompatible AQI scale.

## Assumptions and honest limitations

1. Demo readings are fictional fixed scenarios, not observations. Their hourly timestamps are relative to the current hour for demonstration.
2. Live air is a **CAMS model estimate** delivered by Open-Meteo, not a neighbourhood sensor. Local street conditions may differ. The service caches readings for 10 minutes, rejects missing/old current readings, and uses a 12-hour subset of the returned forecast. Recheck local authorities before consequential decisions.
3. Household “sensitivity” is a user-selected precaution, not a diagnosis. The app does not infer conditions, recommend medication, or measure indoor air.
4. The carbon scenario assumes **0.17 kg CO₂/km for solo car** and **0.06 kg CO₂/passenger-km for transit**. These are explicit illustrative constants, not locally validated emission factors. Distance is total daily travel, not one-way distance. Actual occupancy, power source, traffic and vehicles change results.
5. Lower emissions and lower personal exposure are different objectives. A transit switch is not always feasible or cleaner for the passenger. Severe air-quality guidance takes priority.
6. The household plan may reveal preferences indirectly through adapted actions even though exports exclude explicit sensitivity fields. Review an export before sharing it.
7. The MVP has six supported cities, English content, no user accounts and no long-term history. It does not send notifications or invent community activity. Each assistant question is independent and uses the current household context.
8. This is educational support, not emergency or clinical care. Severe breathing difficulty or chest pain requires urgent local medical help.

## Architecture

Zero runtime dependencies; a small Node HTTP server and native browser modules keep the code auditable and the repository tiny.

```text
public/index.html       Semantic dashboard, views, settings and chat dialogs
public/style.css        Responsive visual system, focus and reduced-motion styles
public/app.js           DOM rendering, navigation, settings, exports and chat
public/engine.js        Shared pure AQI, planning, impact and local-guide logic
server.mjs             Static allowlist, air proxy/cache, AI gateway, validation
test/engine.test.mjs    AQI boundaries and recommendation invariants
test/server.test.mjs    HTTP, security, caching and provider-failure tests
scripts/check-size.mjs  Source budget check (<10 MB)
.github/workflows/ci.yml Automated checks on push
```

## Security and privacy

- Serve only explicitly allowlisted public files; `.env`, Git metadata and server source cannot be downloaded.
- Strict same-origin CSP, no third-party scripts/fonts, no `innerHTML` for user/provider content, framing disabled, MIME sniffing disabled.
- JSON request limit of 8 KiB, question limit of 1,000 characters, supported-city allowlist and normalized household values.
- Fixed upstream URLs prevent caller-selected proxy destinations. Network deadlines, in-flight coalescing and per-city caching bound work.
- In-memory per-IP limits: 60 API requests/minute, with at most 8 AI requests/minute. Forwarded IP headers are deliberately not trusted.
- Same-origin checks for chat POSTs; no permissive CORS. AI requires explicit per-page user opt-in; `store: false` is sent to OpenAI.
- No analytics, tracking cookies, database, question logging or client-visible secrets. Preferences and completion are stored only in localStorage; chat stays in memory. **Reset saved data** clears these local settings and the current chat.

For Internet hosting, run behind HTTPS, set `HOST=0.0.0.0` and `APP_ORIGIN=https://your-host.example`, and configure the platform’s `PORT`. Before exposing a paid key publicly, add authentication, persistent/distributed abuse limits and provider spending caps. In-memory rate limits reset on process restart and may group visitors behind a reverse proxy. Provider retention/processing policies still apply to submitted data.

## Validation

`npm run verify` runs 34 deterministic tests without external network or paid AI calls. Tests use real ephemeral localhost HTTP servers and mock only external providers. Coverage includes all AQI boundaries, invalid values, sensitive households, severe-smog travel, budget-aware indoor advice, carbon arithmetic, stale data, caching, origin checks, malformed/oversized requests, secret-file denial, consent, trusted context, emergency handling and provider fallbacks.

Browser QA covers desktop (1440 px), mobile (390 px), settings updates, persisted checklist state, city switching, assistant responses, literal rendering of HTML-like input, export downloads, impact calculations, simulated live outage and keyboard dialog dismissal. See [validation notes](docs/VALIDATION.md) for final results and limitations.

## Evaluation guide

Try this two-minute walkthrough:

1. Start with Delhi demo: identify the **demo label**, very-unhealthy category and three actionable priorities.
2. Open household settings; select work-from-home, a purifier and a no-cost budget. Watch the recommendations change and inspect **Why this fits your day**.
3. Switch to Chennai to see a good-air scenario; switch back to Delhi and notice the conservative activity advice.
4. Ask “Can my child play outside?” and “Should I open the windows?” Check that the response source is labeled.
5. Explore **My impact**, change distance, and inspect the assumptions rather than a false precision claim.
6. Select **Live air data**, inspect source/time labels, and export a checklist.
7. Configure your API key locally and opt in to demonstrate actual generative explanations.

## Sources and attribution

- Air-quality data: [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api), using [Copernicus Atmosphere Monitoring Service (CAMS)](https://atmosphere.copernicus.eu/). Follow their attribution and licensing terms for deployment; the public endpoint’s free-use terms may not fit commercial traffic.
- AQI categories: [AirNow AQI Basics](https://www.airnow.gov/aqi/aqi-basics/).
- Particle filtration and source control: [US EPA Indoor Air Filtration](https://www.epa.gov/wildfires/indoor-air-filtration) and [AirNow Be Smoke Ready](https://www.airnow.gov/wildfires/be-smoke-ready/). Particle-reduction guidance does not address every urban gas pollutant.
- AI integration: [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create).

## Submission rules

- Public repository: **https://github.com/immortalfoodie/Vaatavaran**.
- Use only the **main** branch; no feature branches are required.
- Source is well below **10 MB**; generated QA screenshots and dependencies are ignored. `npm run verify` enforces the source budget. Git history is checked separately before delivery.
- No competition submission attempt is made by this application or its tests. Submit the repository link through the competition portal yourself, within the maximum three attempts.

MIT licensed. Original vector illustration and interface; no downloaded image assets.

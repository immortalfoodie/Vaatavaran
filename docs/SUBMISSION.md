# Submission checklist

- Repository URL: https://github.com/immortalfoodie/Vaatavaran
- Chosen vertical: **Urban Air Quality Assistant**.
- Public visibility required; check the repository’s “Public” label before submitting.
- Exactly one branch: **main**. Avoid creating extra branches for the challenge.
- Run `npm run verify`; confirm the source budget remains below 10 MB.
- Keep `.env`, API keys, generated screenshots and node_modules out of commits.
- README includes the persona, logic, setup, assumptions, sources and known limitations.
- To demonstrate actual GenAI, configure a server-side OpenAI API key and opt in within the assistant. Demo/local-guide operation is explicitly labeled and is not a substitute for that demonstration.
- Test `npm start` in a fresh clone; no dependency installation is required.
- Submit the repository link through the challenge portal. **This project does not consume any submission attempts.** The maximum three-attempt rule applies to the portal, not Git commits or local tests.

## Suggested explanation for evaluators

Vaatavaran turns air-quality data into an explainable daily plan for urban households. Its deterministic engine prioritizes health-sensitive exposure decisions, budget and travel constraints. A server-side generative assistant explains that trusted context, with explicit opt-in and an honest local fallback. Low-emission alternatives include transparent carbon assumptions; indoor advice focuses on source control and practical filtration. The implementation uses no runtime dependencies, includes HTTP and decision-boundary tests, and clearly separates demo scenarios from live modelled data.

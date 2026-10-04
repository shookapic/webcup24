# F45 / F46 world wayfinding: handoff from B to A

Status: **committed** on B's branch `world`, built and exercised on a disposable scratch server that combines A's `8fe6b85` (real `/api/places`) with B's world build; **not integrated** in A's tree, **not deployed**.

## What the player gets
- Every official place from `GET /api/places` appears in the world as a pole with a marker (red cross for hospital/emergency kinds, amber ball for services) and a floating text label (`HÔPITAL Hôpital de Terra Nova · 24 h`; kind + name in text, never colour alone). Emergency labels are always shown; others within 45 m.
- **F46 emergency guidance in one action**: the button "Urgences : où aller ? (G)" or the key `G` draws a dashed ground route from the player to the nearest hospital/emergency place (by route length), with a panel (name, kind, distance, stop, "Ouvert 24 h sur 24", "Appeler le 112" link, details in the phone, stop). `G` again or `Échap` stops. Start and arrival are announced once in a polite live region; the distance text is visual only.
- **Proximity prompt**: within 12 m of a place a small card names it with its hours and a "Détails dans le téléphone (T)" action (once per place per session).
- Arrival at the entrance is detected (3 m) and stated.
- Guests (orbit view) also see the labels; guidance starts from the spawn point.

## What A is asked to add (Phone.jsx is A's file; narrow, optional)
`PhoneScreen` / `PhoneFallback` already receive `places`. B's `App.jsx` now also passes **`onLocate(place)`** and **`guidedPlaceCode`** in the screen props. On the Places page, per place card, when `onLocate` is a function render a button "Me guider / Guide me" (`onClick={() => onLocate(item)}`, `aria-pressed={guidedPlaceCode === item.code}` or a "Guidage en cours" label). B's side closes the phone and starts the route. No other change is needed; until A adds the button, the key/button and prompt already work.

## Data and a seed text to reconcile
- Entrances are code in `world/src/layout.js` (`placeSites`, keyed by the API `code`; unknown codes fall back to their stop shelter, so staff-added places still get a marker and a route).
- A's seed text for `urgences-hopital` says "côté nord de l'hôpital"; the modelled ambulance bay is on the **east (rear) face**, reached along the north side. Suggest "à l'arrière de l'hôpital (côté est), accessible par le côté nord" or editing the entry in the admin.
- The route is cosmetic (path graph + bends around benches, trees, lamps, supports and buildings), not authoritative navigation.

## Evidence
`node tools/qa/wayfinding-check.mjs <base> <outDir>` (needs a server with `/api/places`): site data checks (7 entrances on open ground, routes clear of solid buildings, unknown-code fallback) and a real-player run: 7 labels, button, `G` guidance to the hospital (40 m) with live announcement, walking the drawn route to arrival, `Escape`, a second place through the `onLocate` path, the proximity prompt, no console errors. Captures `docs/qa-captures/wayfinding/`. Labels: PASS (local, disposable data); UNVERIFIED: Phone "guide me" button (A), real device/screen reader, Firefox, low tier frame cost with labels (7 DOM nodes).

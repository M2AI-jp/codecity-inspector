# 30 Town Domain

`index.mjs` is the only public boundary. It converts a `SemanticModel` v1 into
a deterministic, JSON-serializable `TownModel` v1. It imports nothing and does
not read repositories, assign coordinates, choose images, or use randomness.

```js
import { buildTownModel, validateTownModel } from './ship/30-town-domain/index.mjs';

const town = buildTownModel(semanticModel);
const check = validateTownModel(town); // { ok: true, issues: [] }
```

The model has `repository`, fourteen canonical `facilities`, evidence-tagged
`facts`, a five-tab `guild`, ordered `investigations`, Lv0–5
`habitability`, and exactly nine allowed `rewards.bindings`. Rewards are
activated only by observed transitions; self-reported claims are ignored.

The facts include an inferred repository personality (`post_town`,
`workshop_town`, `port_town`, `watch_post`, or `research_village`). Only a
non-post-town personality makes the service-only gate and inn not applicable;
unknown capability evidence remains unknown for every other facility.

Facility presence is `present`, `missing`, `unknown`, or `not_applicable`.
Unknown is never converted into missing. `ruin` is dirt (walkable and not a
habitability failure), while repair is represented only as canonical `shop`
with `role`/`variant` `repair`.

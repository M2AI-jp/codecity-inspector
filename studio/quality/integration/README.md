# Backend integration

Cross-module tests import only public `index.mjs` boundaries. The inert
repository created by the test contains scripts that deliberately throw if
executed; CodeCity only reads their bytes and metadata. The test proves the
serialized path `InspectionReport -> SemanticModel -> TownModel -> WorldPlan`
and the L1 identity/L2 content separation. It does not claim the browser game
KGI.

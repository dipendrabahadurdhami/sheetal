// check-schema-ownership: checks every model in backend-core/prisma/schema.prisma is tagged `/// @app <id>` and
// that the tag matches the models listed in that app's manifest.
// Where it fits: part of `npm run check`. Design: docs/architecture/FOLDERS-AND-MOVE-PLAN.md section 5 and step 4.
// How it works today: the models are not tagged yet (the tags arrive with the database tasks, step 4), so it passes.
// The real check replaces this file once the tags exist.
// Rules: read-only; it never edits the schema (TEAM-RULES rule 2: one schema.prisma, edited whole by the Database specialist).
console.log("check-schema-ownership: models are not tagged with /// @app yet, nothing to check.");

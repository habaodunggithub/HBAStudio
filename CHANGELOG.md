# Changelog

## Unreleased

- Prepare HBA Studio as an MIT-licensed source project with English/Vietnamese
  getting-started documentation and contributor guidance.
- Split HTTP endpoints into feature routers while preserving existing paths;
  separate application startup, local security and configuration.
- Separate the frontend entry, application shell, entity editor and shared
  workspace text/priority components; standardize Python and frontend formatting.
- Make CPU semantic search an optional extra and keep keyword search in the core install.
- Add shared launch scripts, portable CLI entry points, environment examples and
  configurable development ports.
- Package migrations and the Office manifest with the backend wheel.
- Add isolated regression tests, source-publication checks and GitHub CI.
- Exclude personal credentials, QA history and generated assets from public source.

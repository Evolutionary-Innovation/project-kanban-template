# Independent Example Project

This fixture demonstrates using the Project Kanban Template with a different project identity and schema configuration. It is intentionally not a Trade-MSTR clone.

The integration test copies the template extension into an isolated temporary workspace containing this project's config and Markdown documents, then verifies board loading and writes. This keeps the example focused on project configuration and avoids a second checked-in copy of the extension implementation.

To try it manually, copy the root `.github/extensions/project-kanban/` directory into this project's `.github/extensions/project-kanban/`, then open the project in a Copilot host that loads workspace extensions.

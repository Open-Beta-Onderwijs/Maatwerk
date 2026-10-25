# Naming map (old name -> new name)

Keeps goldens and parity rows traceable after renames (PLAN.md 2.5).

| Old (reference)                                                  | New (Maatwerk)                                                              | Since             |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------- |
| Electron `appId` `nl.school.rtti-app` (`productName` `Maatwerk`) | Tauri identifier `nl.openbetaonderwijs.maatwerk` (`productName` `Maatwerk`) | Step 0            |
| `window.rtti` bridge                                             | `window.maatwerk`                                                           | Step 3a (planned) |
| `rtti_export.typ`                                                | `rapport.typ`                                                               | Step 5a (planned) |
| `<__rtti_vraag>` / `<__rtti_cursor>`                             | `<__maatwerk_vraag>` / `<__maatwerk_cursor>`                                | Step 5a (planned) |

## Reload TestPit settings

The registry is read **once** and the result is cached by the extension. Switching profiles uses the cache.

Run **ESI Helper: Reload TestPit Settings** after you

- add, rename or remove a profile in TestPit,
- point a profile at a different configuration file,
- install TestPit and start it for the first time.

Changes to the *content* of a configuration file the active profile already uses are picked up automatically; no reload is needed for those.

**ESI Helper: Show Component Validation Info** prints the executable, the active profile and the configuration files it resolved to the *esi Helper* output channel — useful when names are unexpectedly reported as unknown.

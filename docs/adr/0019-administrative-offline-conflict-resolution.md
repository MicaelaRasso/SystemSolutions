# Administrative resolution of offline conflicts

**Status: accepted**

An offline operation rejected because server state changed is preserved as a `Conflicto de sincronización` and resolved explicitly by an Administrador regular or Super administrador. Resolution may accept the operation, reject it, or require a new correction, with a mandatory reason, the original payload, and the decision retained for audit; the system does not use silent last-write-wins merging because field work, signatures, and certificate history are evidence-bearing records.

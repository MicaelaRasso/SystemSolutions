# On-demand manual backup export without retention or restoration

**Status: accepted**

M8 provides an unencrypted, on-demand `Backup manual` generated only by the Súper Administrador as either a complete export or an inclusive activity-date-range export. The result is downloaded immediately and is not retained by System Solutions; it includes application-owned records and referenced files with a manifest, but excludes generated PDFs, authentication internals, secrets, credentials, and infrastructure configuration. The system records generation metadata and warnings, but M8 provides no restore workflow, RPO, or RTO because this feature is a downloadable information export rather than an uploadable recovery mechanism.

The export is exposed through one authenticated application-data gateway capability. It uses a consistent point-in-time database snapshot while work continues, includes related referential context for date-range activity, discloses missing files, and fails clearly when an immediate export exceeds its operational limit instead of creating a retained asynchronous job.

The immediate-download guard defaults to 50 MiB for the generated ZIP and 20 seconds of generation time. Deployments may tune these limits with `BACKUP_MAX_ARCHIVE_BYTES` and `BACKUP_MAX_DURATION_MS`; exceeding either limit records a failed generation attempt and returns an actionable error without retaining partial output.

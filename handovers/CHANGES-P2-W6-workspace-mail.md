# CHANGES P2-W6 Workspace, part 2d: business email

- `business/backend/src/modules/mail/{routes,dns,id}.ts` → `apps/workspace/backend/` (`mail.repository.ts`, `mail.service.ts`, `mail.controller.ts`,
  `mail-dns.ts`), registered by `workspaceRoutes` (which now takes the DNS `resolver` the tests swap). The old files are shims (`mailRoutes` registers
  nothing; `dns.ts` and `id.ts` re-export; `cleanHtml` is re-exported).
- Same routes, answers, messages and status codes; `/mail/inbound` still needs only the shared secret.
- Setting email up (domain added, checked, removed; mailbox added, changed, removed) writes an audit line (new: `mail.domain_added|removed`,
  `mail.mailbox_added|updated|removed`) and an event in ONE transaction; sending writes `workspace.mail.sent` with the message. Reading, flags, folders
  and drafts are a person's own mail work: no audit line, as before.
- A read-only support session can read mail but changes nothing, not even the "read" mark.
- Agreed cross-business write (as before): mail between Sheetal mailboxes goes straight into the recipient's mailbox, after checking their storage.
- No migration (mail rows have no version column). Tests: `mail.test.ts` unchanged; new `business/backend/test/mail-kernel.test.ts`.
  `no-old-names.test.js`: the 2 look-alike comments of the old mail file are gone, so its pinned entry is removed.

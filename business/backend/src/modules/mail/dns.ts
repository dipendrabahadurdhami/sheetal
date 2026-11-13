// DNS records for business email: moved to the Workspace app (apps/workspace/backend/mail-dns.ts) in P2-W6. This file only re-exports it, so old
// import paths (the mail tests' Resolver type) keep working. Rules: no new code imports this path; it is deleted at the end of Phase 2.
export * from "@sheetal/app-workspace/backend/mail-dns";

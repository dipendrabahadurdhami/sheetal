-- Fuller job applications: answers to the standard questions, and extra questions chosen per job.
ALTER TABLE "job_posts" ADD COLUMN "form" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "job_applications" ADD COLUMN "answers" JSONB NOT NULL DEFAULT '{}';

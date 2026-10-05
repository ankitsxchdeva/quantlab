import { randomUUID } from "node:crypto";

/*
 * In-memory job store behind /api/run's async pattern: POST creates a job and
 * runs the pipeline detached, GET on /api/run/[id] reports on it.
 *
 * This is deliberately a module-level Map: the app runs as a single container,
 * so jobs DO NOT survive a restart and are not visible to a second instance.
 * Clients treat an unknown id as expired and simply run again.
 *
 * Entries expire lazily: any access first sweeps entries older than the TTL,
 * so an abandoned job is reclaimed on the next request rather than on a timer.
 */

export const JOB_TTL_MS = 15 * 60_000;

export type JobStatus = "running" | "done" | "error";

export interface JobEntry {
  status: JobStatus;
  createdAt: number;
  /** "done": the exact payload the synchronous route used to return. "error": its error body. */
  payload?: Record<string, unknown>;
  /** The HTTP status the synchronous route would have answered with. Kept for tests and logs; GET always answers 200. */
  statusCode?: number;
}

const jobs = new Map<string, JobEntry>();

function sweepExpired(now: number): void {
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) jobs.delete(id);
  }
}

export function createJob(now: number = Date.now()): string {
  sweepExpired(now);
  const id = randomUUID();
  jobs.set(id, { status: "running", createdAt: now });
  return id;
}

export function getJob(id: string, now: number = Date.now()): JobEntry | undefined {
  sweepExpired(now);
  const job = jobs.get(id);
  if (job && now - job.createdAt > JOB_TTL_MS) {
    jobs.delete(id);
    return undefined;
  }
  return job;
}

export function completeJob(id: string, payload: Record<string, unknown>): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = "done";
  job.payload = payload;
  job.statusCode = 200;
}

export function failJob(id: string, statusCode: number, payload: Record<string, unknown>): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = "error";
  job.payload = payload;
  job.statusCode = statusCode;
}

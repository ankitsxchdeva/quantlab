import { NextResponse } from "next/server";
import { preflight, withCors } from "@/lib/cors";
import { getJob } from "@/lib/runJobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(req: Request): NextResponse {
  return preflight(req);
}

// Polling endpoint for jobs accepted by POST /api/run. All three job states
// answer 200; only an unknown id is a 404.
export async function GET(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  return withCors(handleGet(params.id), req);
}

function handleGet(id: string): NextResponse {
  const job = getJob(id);
  // Jobs live in one container's memory and do not survive a restart, so an
  // unknown id covers never-existed, expired (15 min TTL), and lost-to-restart
  // alike. Clients respond by simply running again.
  if (!job) {
    return NextResponse.json({ error: "Unknown or expired run id" }, { status: 404 });
  }
  if (job.status === "running") {
    return NextResponse.json({ status: "running" });
  }
  if (!job.payload) {
    // Unreachable: done/error jobs always carry a payload.
    return NextResponse.json({ error: "Job finished without a result" }, { status: 500 });
  }
  return NextResponse.json({ status: job.status, ...job.payload });
}

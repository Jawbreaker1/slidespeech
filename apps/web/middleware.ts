import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  // ngrok authenticates first. Do not forward the shared login to app/API code.
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  return NextResponse.next({ request: { headers } });
}

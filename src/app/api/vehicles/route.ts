import { NextResponse } from "next/server";

const UPSTREAM =
  process.env.VEHICLE_API_URL ??
  "http://10.0.7.184:8010/v1/seq/vehicle_positions";

export async function GET() {
  const res = await fetch(UPSTREAM, { cache: "no-store" });
  if (!res.ok) {
    return NextResponse.json(
      { error: "upstream error" },
      { status: res.status }
    );
  }
  const data = await res.json();
  return NextResponse.json(data);
}

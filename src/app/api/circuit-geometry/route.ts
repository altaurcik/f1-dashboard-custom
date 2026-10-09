import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
export async function GET(request: NextRequest) {
	const filename = request.nextUrl.searchParams.get("file") || "";
	if (!/^[a-z0-9-]+\.geojson$/i.test(filename)) return NextResponse.json({ available: false });
	try {
		const json = await readFile(path.join(process.cwd(), "public", "circuits", filename), "utf8");
		return new NextResponse(json, {
			headers: { "Content-Type": "application/geo+json", "Cache-Control": "public, max-age=3600" },
		});
	} catch {
		return NextResponse.json({ available: false });
	}
}

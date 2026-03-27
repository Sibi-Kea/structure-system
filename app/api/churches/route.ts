import { Prisma, Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getServerAuthSession } from "@/lib/auth/session";
import { churchSchema } from "@/lib/validations/church";

function unauthorized() {
  return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
}

function normalizeChurchSlug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function GET() {
  const session = await getServerAuthSession();
  if (!session?.user || session.user.role !== Role.SUPER_ADMIN) {
    return unauthorized();
  }

  const churches = await db.church.findMany({
    include: {
      pastor: { select: { name: true, email: true } },
      _count: { select: { members: true, users: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(churches);
}

export async function POST(request: Request) {
  const session = await getServerAuthSession();
  if (!session?.user || session.user.role !== Role.SUPER_ADMIN) {
    return unauthorized();
  }

  const body = (await request.json()) as Record<string, unknown>;
  const nameRaw = String(body.name ?? "");
  const rawSlug = String(body.slug ?? "");
  const normalizedSlug = normalizeChurchSlug(rawSlug) || normalizeChurchSlug(nameRaw);

  const parsed = churchSchema.safeParse({
    ...body,
    name: nameRaw,
    slug: normalizedSlug,
  });
  if (!parsed.success) {
    return NextResponse.json({ message: "Validation failed", errors: parsed.error.flatten() }, { status: 400 });
  }

  let church;
  try {
    church = await db.church.create({
      data: {
        name: parsed.data.name,
        slug: parsed.data.slug,
        email: parsed.data.email || null,
        phone: parsed.data.phone || null,
        address: parsed.data.address || null,
        pastorId: parsed.data.pastorUserId || null,
        createdById: session.user.id,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ message: "Church name or slug already exists." }, { status: 409 });
    }
    return NextResponse.json({ message: "Could not create church." }, { status: 500 });
  }

  await db.user.updateMany({
    where: {
      id: session.user.id,
      role: Role.SUPER_ADMIN,
      churchId: null,
    },
    data: {
      churchId: church.id,
    },
  });

  return NextResponse.json(church, { status: 201 });
}

